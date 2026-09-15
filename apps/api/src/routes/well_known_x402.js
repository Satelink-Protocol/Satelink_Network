// apps/api/src/routes/well_known_x402.js
//
// GET /.well-known/x402 — M7 (T-25): every priced route, in one place, for an
// x402-aware agent that wants to discover what it can pay for without probing
// individual endpoints for a 402. Purely descriptive — reads the SAME env vars
// the actual payment enforcement (src/payments/x402/middleware.js) reads, but
// is an independent file so a change here can never affect payment behavior.
//
// HONESTY NOTE: the four /v1/intelligence/* routes are listed because they
// are real, wired x402-payable routes in the product plan (T-27/T-11) — but
// the M3 work that serves them was never built (see apps/web's /intelligence
// page and apps/mcp-server's intelligence tools for the same note). Each
// entry below carries `live: false` and says so plainly; this file must
// never claim a route is live when it 404s.

import { Router } from 'express';

const API_BASE = () => process.env.API_BASE_URL || 'https://rpc.satelink.network';
const X402_NETWORK = () => process.env.X402_NETWORK || 'eip155:8453';
const X402_PAY_TO = () => process.env.X402_PAY_TO || '0x966E1Ae22996545015b1414B35234b10719d7Ad4';
const BUNDLE_PRICE_USD = () => process.env.X402_BUNDLE_PRICE_USD || '0.10';
const BUNDLE_CALLS = () => Number(process.env.X402_BUNDLE_CALLS || 1000);

const INTELLIGENCE_ROUTES = [
  ['funding-rate-heatmap', 'Funding-rate heatmap across perp markets — derived analytics, not raw quotes.'],
  ['open-interest-shifts', 'Recent shifts in open interest across markets — derived, not raw quotes.'],
  ['liquidation-clusters', 'Clustered liquidation levels/density — derived, not raw quotes.'],
  ['market-microstructure', 'Market microstructure summary (spread, depth, imbalance) — derived, not raw quotes.'],
];

function listing() {
  const base = API_BASE();
  const network = X402_NETWORK();
  const payTo = X402_PAY_TO();
  return {
    schema_version: '1.0',
    service: 'Satelink',
    network,
    pay_to: payTo,
    asset: 'USDC',
    routes: [
      {
        method: 'POST',
        resource: `${base}/rpc/polygon`,
        price: `$${BUNDLE_PRICE_USD()} = ${BUNDLE_CALLS().toLocaleString('en-US')} calls`,
        description:
          'Polygon PoS (chain 137) JSON-RPC — the full standard method set (eth_call, eth_getBalance, ' +
          'eth_blockNumber, eth_getLogs, eth_getTransactionReceipt, eth_sendRawTransaction, and the rest).',
        live: true,
      },
      ...INTELLIGENCE_ROUTES.map(([path, description]) => ({
        method: 'GET',
        resource: `${base}/v1/intelligence/${path}`,
        price: '$0.01/call',
        description,
        live: false,
        note: 'Wired end-to-end (same x402 rail as /rpc/polygon); the serving endpoint is not deployed yet — returns 404, never a fabricated response.',
      })),
    ],
    manifest_url: `${base}/.well-known/satelink.json`,
    docs: 'https://docs.satelink.network',
  };
}

export function createWellKnownX402Router() {
  const router = Router();
  router.get('/x402', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json(listing());
  });
  return router;
}
