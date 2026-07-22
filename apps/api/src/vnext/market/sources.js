// Discovery source adapters (M8) — one per external supplier registry:
// Agentic Market, x402scan, Ampersend, Pay.sh, and MCP registries. Each adapter
// fetches its source (network is the injected `fetchFn` boundary) and normalizes
// heterogeneous responses into a common SupplierRecord. Parsing is defensive:
// malformed/partial entries are skipped, not thrown, so one bad row never poisons
// a discovery round.
//
// SupplierRecord (normalized): {
//   supplierId, adapterId, url, supportedWorkloads[], supportedSettlementModes[],
//   supportedPaymentRails[], supportedChains[], basePrice, currency, reputation,
//   paymentMethods[], protocols[], source
// }

const DEFAULT_ENDPOINTS = {
  'agentic-market': 'https://api.agentic.market/x402/resources',
  'x402scan': 'https://x402scan.com/api/resources',
  'ampersend': 'https://api.ampersend.io/directory',
  'paysh': 'https://pay.sh/api/services',
  'mcp-registry': 'https://registry.modelcontextprotocol.io/servers',
};

function str(v, d = '') { return v == null ? d : String(v); }
function arr(v) { return Array.isArray(v) ? v.filter((x) => x != null).map(String) : []; }
function num(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }

// Coerce a raw listing (from any source) into a normalized record, or null.
function normalize(raw, source) {
  if (!raw || typeof raw !== 'object') return null;
  const url = str(raw.url || raw.resource || raw.endpoint || raw.uri);
  const id = str(raw.id || raw.supplierId || raw.name || url);
  if (!id || !url) return null; // must have identity + a callable URL
  return {
    supplierId: `${source}:${id}`,
    adapterId: 'x402-purchase',
    url,
    supportedWorkloads: ['x402-purchase'],
    supportedSettlementModes: ['PRE'],
    supportedPaymentRails: arr(raw.paymentRails || raw.rails).length ? arr(raw.paymentRails || raw.rails) : ['x402'],
    supportedChains: arr(raw.chains || raw.networks).length ? arr(raw.chains || raw.networks) : ['eip155:8453'],
    basePrice: num(raw.price ?? raw.amount ?? raw.maxAmountRequired, 0),
    currency: str(raw.asset || raw.currency || 'USDC'),
    reputation: 50, // discovered suppliers start neutral; benchmark refines it
    paymentMethods: arr(raw.paymentMethods || raw.methods),
    protocols: arr(raw.protocols).length ? arr(raw.protocols) : ['x402'],
    source,
  };
}

// Each source knows how to reach the array of raw listings inside its payload.
const EXTRACTORS = {
  'agentic-market': (j) => j.items || j.resources || [],
  'x402scan': (j) => j.resources || j.data || [],
  'ampersend': (j) => j.directory || j.services || [],
  'paysh': (j) => j.services || j.items || [],
  'mcp-registry': (j) => j.servers || j.items || [],
};

export function createSource(name, { fetchFn, endpoint } = {}) {
  const url = endpoint || DEFAULT_ENDPOINTS[name];
  const extract = EXTRACTORS[name];
  if (!url || !extract) throw new Error(`unknown discovery source '${name}'`);
  const doFetch = fetchFn || globalThis.fetch;
  return {
    name,
    async discover() {
      const res = await doFetch(url, { method: 'GET', headers: { accept: 'application/json' } });
      if (!res || !res.ok) return { source: name, records: [], error: `http_${res ? res.status : 'no_response'}` };
      let body;
      try { body = await res.json(); } catch { return { source: name, records: [], error: 'bad_json' }; }
      const rawList = extract(body) || [];
      const records = [];
      for (const raw of rawList) { const r = normalize(raw, name); if (r) records.push(r); }
      return { source: name, records };
    },
  };
}

export const SOURCE_NAMES = Object.freeze(Object.keys(DEFAULT_ENDPOINTS));

/** Build all five sources with a shared fetchFn (or per-source endpoints). */
export function createAllSources({ fetchFn, endpoints = {} } = {}) {
  return SOURCE_NAMES.map((name) => createSource(name, { fetchFn, endpoint: endpoints[name] }));
}

export { normalize, DEFAULT_ENDPOINTS };
