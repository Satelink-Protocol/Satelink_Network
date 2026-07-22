// CDP x402 Bazaar discovery source (M8) — the real, live, canonical index of
// x402-payable resources (https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources).
// Verified live 2026-07-22: 100 resources, 98% updated within 30 days, 108 priced
// Base-USDC-`exact` resources on Satelink's rail. Parses the REAL response schema:
//
//   item:   { resource, serviceName, description, tags[], type, lastUpdated, accepts[] }
//   accept: { scheme, network, asset, amount, payTo, extra:{name,version}, maxTimeoutSeconds }
//
// Plugs into the existing M8 DiscoveryAgent (any {name, discover()} source). The
// network boundary is the injected fetchFn (real global fetch in prod; captured
// fixture in tests). Defensive: items without a callable URL or a priced
// on-network `exact` accept are skipped, never thrown.

const DEFAULT_ENDPOINT = 'https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources';
const BASE_MAINNET = 'eip155:8453';

function slug(s) { return String(s).replace(/[^a-zA-Z0-9._:/-]/g, '').slice(0, 120); }
function assetCurrency(a) {
  const n = a && a.extra && a.extra.name;
  if (n) return /usd/i.test(n) ? 'USDC' : String(n);
  return 'USDC';
}

// Pick the priced `exact` accept for the target network, if any.
function pickAccept(accepts, network) {
  if (!Array.isArray(accepts)) return null;
  for (const a of accepts) {
    if (!a || a.scheme !== 'exact' || a.network !== network) continue;
    const amt = a.amount ?? a.maxAmountRequired;
    if (amt == null || String(amt) === '0') continue;
    return a;
  }
  return null;
}

function normalizeItem(item, network) {
  if (!item || typeof item !== 'object') return null;
  const url = String(item.resource || '');
  if (!/^https?:\/\//.test(url)) return null;              // must be callable
  const accept = pickAccept(item.accepts, network);
  if (!accept) return null;                                 // must be priced+exact on our rail
  const id = slug(item.serviceName || url);
  return {
    supplierId: `cdp-bazaar:${id}`,
    adapterId: 'x402-purchase',
    url,
    supportedWorkloads: ['x402-purchase'],
    supportedSettlementModes: ['PRE'],
    supportedPaymentRails: ['x402'],
    supportedChains: [network],
    basePrice: Number(accept.amount ?? accept.maxAmountRequired ?? 0),
    currency: assetCurrency(accept),
    reputation: 50,                                         // benchmark refines
    paymentMethods: ['x402'],
    protocols: ['x402'],
    source: 'cdp-bazaar',
    marketMeta: {
      serviceName: item.serviceName || null,
      description: (item.description || '').slice(0, 200),
      tags: Array.isArray(item.tags) ? item.tags.slice(0, 10) : [],
      payTo: accept.payTo || null,
      asset: accept.asset || null,
      lastUpdated: item.lastUpdated || null,               // freshness/staleness signal
      url,
    },
  };
}

/**
 * @param {object} o
 *  - fetchFn: injected transport (default global fetch)
 *  - endpoint: override (default CDP Bazaar)
 *  - network: target CAIP-2 network (default Base mainnet)
 *  - maxItems: cap normalized records (safety; default 500)
 * @returns {{ name:'cdp-bazaar', discover():Promise<{source,records,error?}> }}
 */
export function createBazaarSource({ fetchFn, endpoint, network = BASE_MAINNET, maxItems = 500 } = {}) {
  const url = endpoint || DEFAULT_ENDPOINT;
  const doFetch = fetchFn || globalThis.fetch;
  return {
    name: 'cdp-bazaar',
    async discover() {
      let res;
      try { res = await doFetch(url, { method: 'GET', headers: { accept: 'application/json' } }); }
      catch (e) { return { source: 'cdp-bazaar', records: [], error: `fetch_error:${(e && e.message) || e}` }; }
      if (!res || !res.ok) return { source: 'cdp-bazaar', records: [], error: `http_${res ? res.status : 'no_response'}` };
      let body;
      try { body = await res.json(); } catch { return { source: 'cdp-bazaar', records: [], error: 'bad_json' }; }
      const items = Array.isArray(body) ? body : (body.items || []);
      const records = [];
      for (const it of items) {
        const r = normalizeItem(it, network);
        if (r) records.push(r);
        if (records.length >= maxItems) break;
      }
      return { source: 'cdp-bazaar', records };
    },
  };
}

export { normalizeItem, DEFAULT_ENDPOINT, BASE_MAINNET };
