// Per-rail prices for discovery, from the PlanCatalog (`rails` + `meters`).
// One place for every public price label, so /v1/pricing, /.well-known/satelink.json
// and /.well-known/x402 can never disagree. Enforcement is unchanged:
// credit_service.PRICE_PER_CALL_USDT (credits) and x402/config.js (bundle) —
// test/catalog_consistency.test.js fails CI if the catalog drifts from them.
// x402 env overrides (X402_BUNDLE_PRICE_USD / X402_BUNDLE_CALLS) still win here,
// because the payment middleware honours them: discovery shows what is charged.
import { loadCatalog } from './catalog.mjs';

const usd = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;

export function railPrices(c = loadCatalog(), env = process.env) {
  const r = c.rails;
  const bundleUsd = Number(env.X402_BUNDLE_PRICE_USD || r.rpc_x402_bundle.price_usd);
  const bundleCalls = Number(env.X402_BUNDLE_CALLS || r.rpc_x402_bundle.calls);
  const tiUsd = +(c.meters.intelligence_request.uu * c.unit.usd_list_value).toFixed(6);
  return {
    catalog_version: c.version,
    rpc_credits: {
      ...r.rpc_credits,
      rail: 'usdt_credits',
      label: `${usd(r.rpc_credits.price_usd_per_call)} per call — USDT credits (Polygon)`,
    },
    rpc_x402_bundle: {
      ...r.rpc_x402_bundle,
      price_usd: bundleUsd,
      calls: bundleCalls,
      price_usd_per_call: +(bundleUsd / bundleCalls).toFixed(8),
      rail: 'x402',
      label: `${usd(bundleUsd)} = ${bundleCalls.toLocaleString('en-US')} calls — x402 bundle (USDC on Base), ${usd(bundleUsd / bundleCalls)} per call`,
    },
    intelligence_credits: {
      ...r.intelligence_credits,
      price_usd_per_request: tiUsd,
      uu_per_request: c.meters.intelligence_request.uu,
      rail: 'usdt_credits',
      label: `${usd(tiUsd)} per request — metered from api_credits (not a direct x402 challenge on this path)`,
    },
    rails_note: 'Different rails, different prices: never read the x402 bundle and the USDT-credit price as the same product.',
  };
}
