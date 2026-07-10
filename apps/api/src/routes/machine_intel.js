// apps/api/src/routes/machine_intel.js
//
// Machine decision APIs — for agents, bots, protocols and RPC routers, not
// humans:
//
//   GET /v1/compare       — Satelink vs tracked providers, with provenance
//   GET /v1/capabilities  — what this gateway can actually do, from live config/DB
//
// Mounted in app_factory BEFORE the /v1 ai-gateway (same rule as the machine
// onboarding router). Read-only; failures degrade to 503 with a machine-
// readable error, never a 500 stack trace.

import { Router } from 'express';
import { getIntelSummary, recordPricingView } from '../economics/pricing_intelligence/index.js';
import { PRICE_PER_CALL_USDT, TIER_DAILY_LIMIT } from '../billing/credit_service.mjs';
import { getX402Config } from '../payments/x402/config.js';
import { MIN_CONFIRMATIONS } from '../billing/deposit_validation.mjs';

const API_BASE = () => process.env.API_BASE_URL || 'https://rpc.satelink.network';
const VAULT = () => process.env.REVENUE_VAULT_ADDRESS || '0x577D3716d6Ad5b676d230f5409deF9838FABaCEF';
const USDT = () => process.env.USDT_CONTRACT_ADDRESS || '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';

async function servedChains(pool) {
  try {
    const r = await pool.query(
      `SELECT DISTINCT jsonb_array_elements_text(chain_ids) AS chain_id
         FROM registered_nodes WHERE status='active'`);
    const names = { '137': 'Polygon PoS', '1': 'Ethereum', '80002': 'Polygon Amoy' };
    return r.rows.map(c => {
      const id = parseInt(c.chain_id, 10);
      return {
        chain_id: id,
        name: names[c.chain_id] || `chain-${c.chain_id}`,
        endpoint: `${API_BASE()}/rpc/${id === 137 ? 'polygon' : id}`,
      };
    });
  } catch {
    return [];
  }
}

export function createMachineIntelRouter(pool, redis) {
  const router = Router();

  router.get('/compare', async (req, res) => {
    recordPricingView(redis, 'compare');
    try {
      const intel = await getIntelSummary(pool, redis);
      res.setHeader('Cache-Control', 'public, max-age=60');
      res.json({
        ok: true,
        generated_at: intel.generated_at,
        satelink: {
          ...intel.market.satelink,
          machine_preference_score: intel.machine_preference_score,
          performance: intel.performance,
          payment: 'x402 | usdt_polygon_vault',
          settlement: 'on-chain',
        },
        why_choose_satelink: intel.why_choose_satelink,
        market: {
          median_usd_per_million: intel.market.market_median_usd_per_million,
          average_usd_per_million: intel.market.market_average_usd_per_million,
          verified_plans_in_sample: intel.market.verified_plans_in_sample,
          position: intel.market.position,
          providers: intel.market.providers,
          methodology: intel.market.methodology,
        },
        disclaimer:
          'Competitor figures are snapshots of published pricing pages (see source_url/observed_at per row); ' +
          'derived_estimate rows document their unit-conversion assumptions; unverified rows are excluded from aggregates.',
        links: {
          pricing: `${API_BASE()}/v1/pricing`,
          capabilities: `${API_BASE()}/v1/capabilities`,
          manifest: `${API_BASE()}/.well-known/satelink.json`,
        },
      });
    } catch (err) {
      console.error('[MachineIntel] /v1/compare failed:', err.message);
      res.status(503).json({ ok: false, error: 'market_intel_unavailable', retry_after_s: 60 });
    }
  });

  router.get('/capabilities', async (req, res) => {
    recordPricingView(redis, 'capabilities');
    try {
      const x402 = getX402Config();
      const [chains, intel] = await Promise.all([
        servedChains(pool),
        getIntelSummary(pool, redis).catch(() => null),
      ]);
      const base = API_BASE();
      res.setHeader('Cache-Control', 'public, max-age=60');
      res.json({
        ok: true,
        service: 'Satelink RPC Gateway',
        protocol: 'json-rpc-2.0-over-https',
        chains,
        auth_modes: [
          { mode: 'api_key', header: 'X-API-Key', onboarding: `${base}/v1/machine/register` },
          ...(x402.enabled ? [{ mode: 'x402', header: 'PAYMENT', note: 'per-call USDC payment, no account required' }] : []),
          { mode: 'anonymous_free_tier', note: `rate-limited; HTTP 402 with payment instructions when exhausted` },
        ],
        payment_rails: [
          {
            rail: 'usdt_polygon_vault',
            token: 'USDT', chain_id: 137,
            vault_address: VAULT(), token_address: USDT(),
            price_per_call_usd: PRICE_PER_CALL_USDT,
            confirmations_required: MIN_CONFIRMATIONS,
            settlement: 'prepaid credits, deducted atomically per call',
          },
          ...(x402.enabled ? [{
            rail: 'x402',
            token: 'USDC', network: x402.network,
            // Bundle pricing (PR #241): one settlement buys a block of calls.
            bundle_price_usd: parseFloat(x402.bundlePriceUsd),
            bundle_calls: x402.bundleCalls,
            effective_price_per_call_usd: parseFloat(x402.bundlePriceUsd) / x402.bundleCalls,
            settlement: 'instant via x402 facilitator; one payment credits the full bundle',
            spec: 'https://www.x402.org',
          }] : []),
        ],
        tiers: Object.entries(TIER_DAILY_LIMIT).map(([tier, daily_limit]) => ({ tier, daily_limit })),
        performance: intel?.performance ?? null,
        machine_preference_score: intel?.machine_preference_score?.score ?? null,
        discovery: {
          manifest: `${base}/.well-known/satelink.json`,
          pricing: `${base}/v1/pricing`,
          compare: `${base}/v1/compare`,
          openapi: `${base}/openapi.json`,
        },
      });
    } catch (err) {
      console.error('[MachineIntel] /v1/capabilities failed:', err.message);
      res.status(503).json({ ok: false, error: 'capabilities_unavailable', retry_after_s: 60 });
    }
  });

  return router;
}
