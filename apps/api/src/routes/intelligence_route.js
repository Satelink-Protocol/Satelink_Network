// apps/api/src/routes/intelligence_route.js
//
// M3 — Derived trading intelligence: the priced, machine-consumable surface.
//
//   GET /v1/intelligence            — free discovery: metrics, prices, how to pay
//   GET /v1/intelligence/:metric    — metered ($0.01/call) derived intelligence
//
// BILLING (canonical path, no parallel system — prompt §11/§23):
//   Metered through authorizeAndMeter() against api_credits — the SAME balance
//   that an x402 bundle payment (/rpc) or an on-chain USDT deposit funds. An
//   intelligence call deducts METRICS[metric].price_usdt. A real deduction (and
//   only a real one) records a revenue_events_v2 row via recordRpcRevenue with
//   op_type='intelligence' for clean human/machine/intelligence attribution.
//
// AUTH: API key only (x-api-key / Authorization: Bearer). A bare wallet header
//   is deliberately NOT accepted as a billing credential (that bypass was the
//   C1 credit-theft class closed in M0). A machine acquires a key + credits via
//   the x402 bundle on /rpc or POST /v1/machine/register + a USDT deposit.
//
// HONESTY: never fabricates. No snapshot yet → 503 warming_up. Stale upstream →
//   served with stale:true + as_of. Payment required → 402 with x402 pointers.

import { Router } from 'express';
import crypto from 'node:crypto';
import { keyRef } from '../security/key_mask.mjs';
import { authorizeAndMeter, resolveAccount } from '../billing/credit_service.mjs';
import { recordRpcRevenue } from '../workloads/rpc_gateway/rpc_billing.js';
import { readMetric } from '../intelligence/engine.js';
import { METRICS } from '../intelligence/compute.js';

const API_BASE = () => process.env.API_BASE_URL || 'https://rpc.satelink.network';

function extractApiKey(req) {
  const h = req.headers || {};
  if (h['x-api-key']) return String(h['x-api-key']).trim();
  const auth = h['authorization'];
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  return null;
}

// Machine-readable "how to pay" block returned on 402, so an autonomous agent
// can discover the acquire-credits flow without out-of-band docs.
function paymentGuidance() {
  return {
    how_to_pay: [
      {
        rail: 'x402',
        description:
          'Pay the x402 bundle on POST /rpc/polygon (USDC on Base). One bundle credits your account; ' +
          'those credits are then spent by intelligence calls at the per-metric price.',
        resource: `${API_BASE()}/rpc/polygon`,
        discovery: `${API_BASE()}/.well-known/satelink.json`,
      },
      {
        rail: 'usdt_deposit',
        description: 'Deposit USDT on Polygon to your registered wallet; credits auto-apply.',
        initiate: `${API_BASE()}/credits/deposit/initiate`,
      },
    ],
  };
}

function withTimeout(promise, ms) {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error('read_timeout')), ms); }),
  ]);
}

function metricsCatalog() {
  return Object.entries(METRICS).map(([name, m]) => ({
    metric: name,
    resource: `${API_BASE()}/v1/intelligence/${name}`,
    price_usdt: m.price_usdt,
    kind: m.kind,
    description: m.description,
  }));
}

export function createIntelligenceRouter(pool, deps = {}) {
  const now = deps.now || (() => Date.now());
  const readTimeoutMs = deps.readTimeoutMs ?? 5000;
  const router = Router();

  // Free discovery — no billing, mirrors /v1/pricing's honesty discipline.
  router.get('/intelligence', (_req, res) => {
    res.json({
      ok: true,
      service: 'Satelink Trading Intelligence',
      pricing_model: 'pay_per_call_credits',
      currency: 'USDT',
      metrics: metricsCatalog(),
      payment: paymentGuidance(),
      note: 'Derived analytics from public market data — not raw feed redistribution, not investment advice.',
    });
  });

  router.get('/intelligence/:metric', async (req, res) => {
    const metric = req.params.metric;
    const spec = METRICS[metric];
    if (!spec) {
      return res.status(404).json({
        ok: false,
        error: 'unknown_metric',
        available_metrics: Object.keys(METRICS),
      });
    }

    const apiKey = extractApiKey(req);
    if (!apiKey) {
      return res.status(402).json({
        ok: false,
        error: 'payment_required',
        code: 402,
        message:
          'Trading intelligence is a paid product. Provide an API key (x-api-key) funded with credits.',
        price_usdt: spec.price_usdt,
        ...paymentGuidance(),
      });
    }

    // Unknown / inactive keys are refused up front (free check, no charge), so
    // they get the same answer whether or not data is available.
    try {
      const acct = await resolveAccount(pool, { apiKey });
      if (!acct) return res.status(401).json({ ok: false, error: 'account_not_found', message: 'Unknown API key or wallet', price_usdt: spec.price_usdt });
      if (acct.status && acct.status !== 'active') return res.status(403).json({ ok: false, error: 'account_inactive', message: `Account status: ${acct.status}`, price_usdt: spec.price_usdt });
    } catch (e) {
      return res.status(503).json({ ok: false, error: 'billing_unavailable', message: e.message });
    }

    // Read FIRST, charge SECOND (fix/ti-charge-after-success). A snapshot that
    // is missing, fails to read or times out returns 503 and charges nothing.
    // The deduction below only runs once there is data to serve, and the data
    // is only returned if the deduction succeeded — never data without payment,
    // never payment without data.
    let snap;
    try {
      snap = await withTimeout(readMetric(pool, metric, { now }), readTimeoutMs);
    } catch (e) {
      console.error(`[Intel] read failed for ${metric} (not charged): ${e.message}`);
      return res.status(503).json({ ok: false, error: 'intelligence_unavailable', message: e.message === 'read_timeout' ? 'read_timeout' : 'read_failed', charged: false });
    }

    if (!snap.available) {
      return res.status(503).json({
        ok: false,
        error: 'warming_up',
        metric,
        message: 'No snapshot has been captured yet for this metric. Retry shortly. You were not charged.',
        charged: false,
      });
    }

    // Prove the payload can be sent BEFORE charging (a response that cannot be
    // serialised must not cost anything).
    try {
      JSON.stringify(snap.data);
    } catch (e) {
      console.error(`[Intel] unserialisable snapshot for ${metric} (not charged): ${e.message}`);
      return res.status(503).json({ ok: false, error: 'intelligence_unavailable', message: 'bad_snapshot', charged: false });
    }

    // Canonical metered deduction — only now that there is data to serve.
    let meter;
    try {
      meter = await authorizeAndMeter(pool, { apiKey, methodPrice: spec.price_usdt, product: 'intelligence' });
    } catch (e) {
      // Fail CLOSED on billing infra error (M4/T-24 principle: never serve free).
      return res.status(503).json({ ok: false, error: 'billing_unavailable', message: e.message });
    }

    if (!meter.ok) {
      const http = meter.http || 402;
      const body = {
        ok: false,
        error: meter.code || 'payment_required',
        message: meter.message,
        price_usdt: spec.price_usdt,
      };
      // Owner controls (paused / cap / auto-use off) are not a funding problem.
      if (http === 402 && !meter.terminal) Object.assign(body, paymentGuidance());
      return res.status(http).json(body);
    }

    // Record real revenue for the deduction (fire-and-forget; only cost > 0).
    if (meter.cost > 0) {
      recordRpcRevenue({
        pool,
        chain: null,
        method: metric,
        apiKey: meter.apiKey || apiKey,
        source: 'intelligence',
        // Never the key: a non-reversible reference + time + nonce (TI_KEY_LOGGING).
        requestId: `intel:${metric}:${keyRef(apiKey)}:${now()}:${crypto.randomBytes(3).toString('hex')}`,
        amountUsdt: meter.cost,
        opType: 'intelligence',
      }).catch(() => {});
    }

    return res.json({
      ok: true,
      metric,
      kind: spec.kind,
      price_usdt: spec.price_usdt,
      billed_usdt: meter.cost,
      tier: meter.tier,
      remaining_today: meter.remaining,
      as_of: snap.as_of,
      age_sec: snap.age_sec,
      stale: snap.stale,
      source_rows: snap.source_rows,
      data: snap.data,
    });
  });

  return router;
}

export default createIntelligenceRouter;
