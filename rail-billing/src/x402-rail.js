// x402 rail — crypto pay-per-call over HTTP, settled through the Coinbase CDP
// facilitator (x402 v2). Mainnet-proven flow.
//
// buildX402Rail(cfg).process(req) returns either:
//   { type: 'settled', payer, txHash, network }   — a valid on-chain payment
//   { type: 'challenge', response }               — a 402 with a PAYMENT-REQUIRED header
//   { type: 'passthrough' }                       — route not gated by x402
//
// Requires env CDP_API_KEY_ID / CDP_API_KEY_SECRET for verify/settle.

import { x402ResourceServer, x402HTTPResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { createCdpAuthHeaders } from '@coinbase/x402';
import { bazaarResourceServerExtension, declareDiscoveryExtension } from '@x402/extensions/bazaar';
import { ExpressAdapter } from '@x402/express';

class JsonAdapter extends ExpressAdapter {
  getAcceptHeader() { return 'application/json'; }
}

export function buildX402Rail(cfg = {}) {
  const {
    price = '$0.01',
    network = 'eip155:8453',
    payTo,
    facilitatorUrl = 'https://api.cdp.coinbase.com/platform/v2/x402',
    routePattern,
    resource,
    description = 'Pay-per-call (x402)',
    discovery = null,
    logger = console,
  } = cfg;
  if (!payTo) throw new Error('x402 rail: payTo (recipient wallet) is required');
  if (!routePattern) throw new Error('x402 rail: routePattern (e.g. "POST /premium") is required');

  let httpServer = null;
  let initialized = false;
  let initFailedAt = 0;
  const INIT_RETRY_MS = 60_000;

  function server() {
    if (httpServer) return httpServer;
    const facilitator = new HTTPFacilitatorClient({ url: facilitatorUrl, createAuthHeaders: createCdpAuthHeaders() });
    const rs = new x402ResourceServer(facilitator).register(network, new ExactEvmScheme());
    rs.registerExtension(bazaarResourceServerExtension);
    const routeConfig = {
      accepts: { scheme: 'exact', price, network, payTo, maxTimeoutSeconds: 60 },
      description,
      mimeType: 'application/json',
      ...(resource ? { resource } : {}),
      ...(discovery ? { extensions: declareDiscoveryExtension(discovery) } : {}),
    };
    httpServer = new x402HTTPResourceServer(rs, { [routePattern]: routeConfig });
    return httpServer;
  }

  async function ensureInit(s) {
    if (initialized || Date.now() - initFailedAt < INIT_RETRY_MS) return;
    try { await s.initialize(); initialized = true; }
    catch (err) { initFailedAt = Date.now(); logger.warn?.(`[x402] facilitator sync unavailable: ${err.message}`); }
  }

  async function process(req) {
    const s = server();
    await ensureInit(s);
    const path = (req.originalUrl || req.url).split('?')[0];
    const paymentHeader = req.header('payment-signature') || req.header('x-payment') || req.header('payment');

    const result = await s.processHTTPRequest({ adapter: new JsonAdapter(req), path, method: req.method, paymentHeader });
    if (result.type === 'no-payment-required') return { type: 'passthrough' };
    if (result.type !== 'payment-verified') return { type: 'challenge', response: result.response };

    const settle = await s.processSettlement(
      result.paymentPayload, result.paymentRequirements, result.declaredExtensions,
      { request: { adapter: new JsonAdapter(req), path, method: req.method } }
    );
    if (!settle.success) return { type: 'challenge', response: settle.response };
    if (!settle.transaction || typeof settle.transaction !== 'string') {
      logger.error?.(`[x402] settle without tx id (payer=${settle.payer}); refusing`);
      return { type: 'challenge', response: { status: 502, headers: {}, body: { error: 'x402_settlement_no_transaction' } } };
    }
    return { type: 'settled', payer: settle.payer, txHash: settle.transaction, network: settle.network || network };
  }

  return { name: 'x402', process };
}
