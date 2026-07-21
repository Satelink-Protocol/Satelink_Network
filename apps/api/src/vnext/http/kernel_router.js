// vNext kernel HTTP surface — mounts the DurableKernel into the live app.
//
// SAFETY: gated behind VNEXT_KERNEL_ENABLED (default OFF). When disabled the
// router is fully inert — every route returns 503 and NO database access, DDL,
// or kernel boot happens. Enabling is a deliberate human decision (per the
// vNext non-negotiable rules: new env vars ship defaults-off). Even when
// enabled, boot failures are contained (503 on vnext routes) and never crash
// the host app or the live money path.
//
// This first wiring exposes lifecycle + observability only (health, journal
// read). No workload adapters are registered and there is no submit endpoint,
// so no money can move through this surface yet — that is deliberate.

import express from 'express';
import { PgDurableStore } from '../reliability/pg_durable_store.js';
import { DurableKernel } from '../reliability/durable_kernel.js';
import { Registry } from '../kernel/registry.js';
import { deriveTxId } from '../kernel/idempotency.js';
import { DecisionEngine } from '../routing/decision_engine.js';
import { Policies } from '../routing/policies.js';
import { FeeEngine } from '../fees/fee_engine.js';
import { X402Context } from '../adapters/x402/x402_context.js';
import { X402PurchaseAdapter } from '../adapters/x402/x402_purchase_adapter.js';
import { X402SettlementAdapter } from '../adapters/x402/x402_settlement_adapter.js';
import { OutboundGuard } from '../reliability/outbound_guard.js';

// Build the outbound safety guard from env caps. Kill switch (VNEXT_OUTBOUND_ENABLED)
// defaults OFF. Caps are optional minor-unit integer strings; unset = unenforced
// for that dimension (but the kill switch still gates all real spend). The
// key-holding signer is intentionally NOT constructed here — enabling outbound
// without a wired signer fails safe (the settlement adapter refuses to pay).
function buildOutboundGuard(store) {
  const numeric = (k) => (process.env[k] != null && process.env[k] !== '' ? process.env[k] : null);
  return new OutboundGuard({
    store,
    enabled: process.env.VNEXT_OUTBOUND_ENABLED === 'true',
    caps: {
      maxPerTx: numeric('VNEXT_OUTBOUND_MAX_PER_TX'),
      maxPerHour: numeric('VNEXT_OUTBOUND_MAX_PER_HOUR'),
      maxPerDay: numeric('VNEXT_OUTBOUND_MAX_PER_DAY'),
      walletFloor: numeric('VNEXT_OUTBOUND_WALLET_FLOOR'),
    },
    clock: () => Date.now(),
  });
}

// Parse the operator-configured x402 resource allowlist. URLs are NEVER taken
// from a request — only from this env allowlist — so /submit cannot be used as
// an SSRF proxy. Malformed config disables the x402 workload (empty list).
function parseResources() {
  try {
    const raw = process.env.VNEXT_X402_RESOURCES;
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((r) => r && typeof r.url === 'string' && /^https?:\/\//.test(r.url))
      .map((r, i) => ({ url: r.url, method: r.method || 'GET', supplierId: r.supplierId || `x402-${i}` }));
  } catch { return []; }
}

function summarizeResult(result) {
  if (!result || typeof result !== 'object') return null;
  const out = { status: result.status ?? null };
  if (result.paidWith) out.paidWith = result.paidWith;
  return out; // deliberately does NOT echo the fetched body (size/PII)
}

// Inert settlement so DurableKernel.boot() has a valid dependency; unused
// because no workload adapters are registered (nothing routes/settles).
const INERT_SETTLEMENT = {
  capabilities: () => ({ modes: ['POST'], units: [], finality: 'INSTANT' }),
  async settleIn() { return { ref: null }; },
  async settleOut() { return { ref: null }; },
  async verify() { return { status: 'settled' }; },
};

export function createVnextKernelRouter(pool, { logger = console } = {}) {
  const router = express.Router();
  const enabled = process.env.VNEXT_KERNEL_ENABLED === 'true';

  if (!enabled) {
    // Fully inert: no DB, no boot. Uniform 503 on every vnext route.
    router.use((_req, res) => res.status(503).json({ ok: false, error: 'vnext kernel disabled' }));
    return router;
  }

  const submitEnabled = process.env.VNEXT_SUBMIT_ENABLED === 'true';
  const resources = parseResources();
  const x402Active = submitEnabled && resources.length > 0;

  let dk = null;
  let bootErr = null;
  // Boot in the background so createApp() stays synchronous and a slow/failed
  // boot never blocks or crashes app startup.
  const ready = (async () => {
    const store = new PgDurableStore(pool);
    await store.init(); // additive vnext_* tables only

    if (x402Active) {
      // Real routing path: x402 purchase workload over the operator allowlist.
      // The x402 adapter self-discovers its (allowlisted, url-bearing) resources,
      // so the durable supplier registry is not used for this path. Settlement
      // constructs x402 payloads but holds no wallet/keys — no real broadcast.
      const ctx = new X402Context();
      const registry = new Registry();
      registry.register(new X402PurchaseAdapter({ resources, ctx }));
      // Outbound guard enforces kill switch + caps + exactly-once. No signer is
      // wired here, so with VNEXT_OUTBOUND_ENABLED=true the adapter fails safe
      // (refuses to pay) until an operator injects a key-holding signer.
      const outboundGuard = buildOutboundGuard(store);
      dk = await DurableKernel.boot({
        store, registry, clock: () => Date.now(),
        settlement: new X402SettlementAdapter({ ctx, guard: outboundGuard }),
        decisionEngine: new DecisionEngine({ clock: () => Date.now() }), policy: Policies.cheapest,
        feeEngine: new FeeEngine(), feePolicy: { type: 'bps', bps: Number(process.env.VNEXT_FEE_BPS || 0) }, feeCurrency: 'USDC',
      });
      logger.log(`[vnext] x402 submit path active with ${resources.length} allowlisted resource(s)`);
    } else {
      // Observability-only: no adapters, no money path.
      dk = await DurableKernel.boot({
        store, registry: new Registry(), settlement: INERT_SETTLEMENT,
        clock: () => Date.now(), useDurableSuppliers: true,
      });
    }

    if (process.env.VNEXT_RECOVERY_TIMER_ENABLED === 'true') {
      dk.startRecoveryTimer({
        intervalMs: Number(process.env.VNEXT_RECOVERY_INTERVAL_MS || 30000),
        onError: (e) => logger.error('[vnext] recovery sweep error:', e && e.message ? e.message : e),
      });
      logger.log('[vnext] recovery timer started');
    }
    logger.log('[vnext] durable kernel booted');
  })().catch((e) => { bootErr = e; logger.error('[vnext] boot failed:', e && e.message ? e.message : e); });

  const guard = async (res) => {
    await ready;
    if (bootErr) { res.status(503).json({ ok: false, error: 'vnext boot failed', detail: String(bootErr.message || bootErr) }); return false; }
    return true;
  };

  router.get('/health', async (_req, res) => {
    if (!(await guard(res))) return;
    res.json({
      ok: true,
      enabled: true,
      submit: submitEnabled,
      x402Resources: x402Active ? resources.length : 0,
      suppliers: dk.supplierRegistry ? dk.supplierRegistry.list().length : 0,
      journalEvents: dk.journal.all().length,
      chainValid: dk.journal.verifyChain(),
      recoveryTimer: !!dk.recoveryScheduler,
      lastRecovery: dk.lastRecovery || null,
    });
  });

  // POST /vnext/submit — run one transaction through the durable kernel.
  // Gated behind VNEXT_SUBMIT_ENABLED (default off). SSRF-safe: `resource` (if
  // given) only SELECTS among the operator allowlist; it is never used as a
  // fetch target directly. Idempotent by client key -> deterministic txId.
  router.post('/submit', express.json({ limit: '16kb' }), async (req, res) => {
    if (!(await guard(res))) return;
    if (!submitEnabled) return res.status(403).json({ ok: false, error: 'vnext submit disabled' });
    const { workload, idempotencyKey, payer, resource } = req.body || {};
    if (!workload || !idempotencyKey) return res.status(400).json({ ok: false, error: 'workload and idempotencyKey are required' });

    const txId = deriveTxId(String(idempotencyKey));
    try {
      const tx = await dk.submit(
        { workload: String(workload), payer: payer ? String(payer) : undefined, query: resource ? { resource: String(resource) } : {} },
        { txId },
      );
      res.json({
        ok: tx.state === 'CLOSED',
        txId,
        state: tx.state,
        supplier: tx.supplier ? tx.supplier.supplierId : null,
        reason: tx.reason || null,
        fee: tx.feeInstruction ? { amount: tx.feeInstruction.feeAmount, currency: tx.feeInstruction.currency } : null,
        result: summarizeResult(tx.result),
      });
    } catch (e) {
      res.status(500).json({ ok: false, txId, error: String((e && e.message) || e) });
    }
  });

  router.get('/journal/:txId', async (req, res) => {
    if (!(await guard(res))) return;
    const phases = dk.journal.read(req.params.txId).map((e) => ({ phase: e.phase, ts: e.ts }));
    res.json({ ok: true, txId: req.params.txId, phases });
  });

  return router;
}
