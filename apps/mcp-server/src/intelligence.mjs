// apps/mcp-server/src/intelligence.mjs
// M7 (T-11): four intelligence tools alongside polygon_rpc — pay-per-call
// ($0.01/call, x402) market intelligence: funding rate heatmap, open interest
// shifts, liquidation clusters, market microstructure.
//
// HONESTY NOTE (do not remove without re-checking): the M3 plan (the actual
// /v1/intelligence/* endpoints these tools call) was never built — M3 was
// skipped in favor of M4/M5/M6. This file is real, working client plumbing —
// it pays via the same x402 rail as polygon_rpc, reuses buildPayingFetch, and
// will start returning real data the moment those routes ship server-side.
// Until then, every call gets a clean 404 from production, which this
// executor turns into an explicit `not_yet_available` result — never a
// confusing raw error, and never a fabricated response. Same discipline as
// apps/web/src/app/intelligence/page.tsx (M5, T-27).

const DEFAULT_INTELLIGENCE_BASE =
  process.env.SATELINK_INTELLIGENCE_URL || 'https://rpc.satelink.network/v1/intelligence';

export const INTELLIGENCE_ENDPOINTS = {
  funding_rate_heatmap: 'funding-rate-heatmap',
  open_interest_shifts: 'open-interest-shifts',
  liquidation_clusters: 'liquidation-clusters',
  market_microstructure: 'market-microstructure',
};

/**
 * @param {object} deps
 * @param {typeof fetch} deps.fetch   The (possibly x402-paying) fetch — same
 *   instance polygon_rpc uses (buildPayingFetch), so a configured wallet pays
 *   for both tool families with the same signing key.
 * @param {string} [deps.baseUrl]
 * @param {string} [deps.apiKey]
 */
export function createIntelligenceExecutor({ fetch, baseUrl = DEFAULT_INTELLIGENCE_BASE, apiKey } = {}) {
  return async function executeIntelligence({ tool, symbol, params = {} }) {
    const path = INTELLIGENCE_ENDPOINTS[tool];
    if (!path) {
      return { ok: false, error: 'unknown_tool', message: `Unknown intelligence tool: ${tool}` };
    }
    const url = new URL(`${baseUrl.replace(/\/$/, '')}/${path}`);
    if (symbol) url.searchParams.set('symbol', symbol);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    const headers = {
      'X-Satelink-Partner': 'mcp-server',
      'X-Satelink-Integration': 'agent-tool',
    };
    if (apiKey) headers['X-API-Key'] = apiKey;

    let response;
    try {
      response = await fetch(url.toString(), { method: 'GET', headers });
    } catch (err) {
      return { ok: false, error: 'network_error', message: err.message };
    }

    if (response.status === 404) {
      return {
        ok: false,
        error: 'not_yet_available',
        message:
          `${tool.replace(/_/g, ' ')} is not live yet — the Satelink intelligence product is launching soon. ` +
          `This tool is wired and ready (same x402 payment path as polygon_rpc); it will start returning real ` +
          `data the moment the endpoint ships. No payment was attempted.`,
      };
    }

    const paymentResponse =
      response.headers.get('x-payment-response') || response.headers.get('payment-response') || null;

    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    if (response.status === 402) {
      return {
        ok: false,
        error: 'payment_required',
        status: 402,
        message: apiKey
          ? 'Payment required but could not be completed automatically.'
          : 'Payment required. Configure SATELINK_WALLET_PRIVATE_KEY (a Base-funded USDC wallet) to pay automatically.',
        payment_requirements: data,
      };
    }

    if (!response.ok) {
      return { ok: false, error: 'intelligence_http_error', status: response.status, data };
    }

    return {
      ok: true,
      status: response.status,
      result: data,
      paid: Boolean(paymentResponse),
      payment_response: paymentResponse,
    };
  };
}
