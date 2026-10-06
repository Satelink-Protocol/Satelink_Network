// Wave 2 exit (C8): do the PRODUCTION discovery surfaces show the catalog prices?
//   node apps/api/scripts/pricing/check_live_consistency.mjs [https://api.satelink.network]
// Exit 1 on any mismatch. Read-only GETs; no auth.
import { railPrices } from '../../src/pricing_v2/rails.mjs';

const base = (process.argv[2] || 'https://api.satelink.network').replace(/\/$/, '');
const r = railPrices(undefined, {});
const bundle = `$${r.rpc_x402_bundle.price_usd.toFixed(2)} = ${r.rpc_x402_bundle.calls.toLocaleString('en-US')} calls`;
const get = async (p) => (await fetch(base + p)).json();
const checks = [];
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

const x = await get('/.well-known/x402');
const rpc = x.routes?.find((t) => t.resource?.endsWith('/rpc/polygon'));
eq('x402 rpc price', rpc?.price, bundle);
eq('x402 rpc rail', rpc?.rail, 'x402');
for (const t of x.routes?.filter((t) => t.resource?.includes('/v1/intelligence/')) || []) {
  eq(`x402 ${t.resource.split('/').pop()} price`, t.price, `$${r.intelligence_credits.price_usd_per_request}/call`);
  eq(`x402 ${t.resource.split('/').pop()} challenge`, t.x402_challenge, false);
}
const m = await get('/.well-known/satelink.json');
eq('satelink.json per-call', m.pricing?.price_per_call_usdt, r.rpc_credits.price_usd_per_call);
eq('satelink.json bundle', m.pricing?.x402_bundle, `${bundle} (USDC on Base)`);
const p = await get('/v1/pricing');
eq('/v1/pricing per-call', p.price_per_call_usdt, r.rpc_credits.price_usd_per_call);
eq('/v1/pricing TI', p.intelligence?.price_usdt_per_call, r.intelligence_credits.price_usd_per_request);
eq('/v1/pricing rails present', Boolean(p.rails), true);

for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok ? '' : `  got=${JSON.stringify(c.got)} want=${JSON.stringify(c.want)}`}`);
const failed = checks.filter((c) => !c.ok).length;
console.log(`${checks.length - failed}/${checks.length} pass against ${base} (catalog ${r.catalog_version})`);
process.exit(failed ? 1 : 0);
