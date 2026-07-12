// x402-kit — createX402Paywall(): an Express middleware that puts a per-call
// USDC paywall in front of any route, settled through the Coinbase CDP
// facilitator (x402 protocol v2). Mainnet-proven flow.
//
//   No payment attached  -> 402 with a machine-readable PAYMENT-REQUIRED
//                           challenge header (an x402 client pays + retries).
//   Payment attached      -> verify -> settle on-chain -> serve (next()).
//
// Settlement happens BEFORE your handler runs, so an unsettled call is never
// executed. On success, req.x402 = { settled, txHash, payer, network }.

import { x402ResourceServer, x402HTTPResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { createCdpAuthHeaders } from '@coinbase/x402';
import { bazaarResourceServerExtension, declareDiscoveryExtension } from '@x402/extensions/bazaar';
import { ExpressAdapter } from '@x402/express';

// /api routes negotiate JSON, never the HTML paywall page.
class JsonAdapter extends ExpressAdapter {
  getAcceptHeader() {
    return 'application/json';
  }
}

function writeSdkResponse(res, response) {
  res.status(response.status);
  for (const [k, v] of Object.entries(response.headers || {})) res.setHeader(k, v);
  if (response.isHtml) return res.send(response.body);
  return res.json(response.body || {});
}

/**
 * @param {object} opts
 * @param {string} [opts.price]         e.g. "$0.01" (default $X402_PRICE or "$0.01")
 * @param {string} [opts.network]       CAIP-2 chain id (default eip155:8453 = Base)
 * @param {string}  opts.payTo          recipient wallet (0x… EOA or contract). REQUIRED.
 * @param {string} [opts.facilitatorUrl] default Coinbase CDP facilitator
 * @param {string}  opts.routePattern   e.g. "POST /premium" — the route being protected
 * @param {string} [opts.resource]      public URL of the route (used for Bazaar discovery)
 * @param {string} [opts.description]   human/agent description of what they get
 * @param {object} [opts.discovery]     optional Bazaar discovery metadata:
 *                                      { method, bodyType, input, inputSchema, output }
 * @param {Console}[opts.logger]        default console
 * @returns Express middleware
 *
 * Requires env CDP_API_KEY_ID and CDP_API_KEY_SECRET (Coinbase CDP) for verify/settle.
 */
export function createX402Paywall(opts = {}) {
  const {
    price = process.env.X402_PRICE || '$0.01',
    network = process.env.X402_NETWORK || 'eip155:8453',
    payTo = process.env.X402_PAY_TO,
    facilitatorUrl = process.env.X402_FACILITATOR_URL || 'https://api.cdp.coinbase.com/platform/v2/x402',
    routePattern,
    resource,
    description = 'Protected endpoint (pay-per-call via x402)',
    discovery = null,
    logger = console,
  } = opts;

  if (!payTo) throw new Error('createX402Paywall: opts.payTo (recipient wallet) is required');
  if (!routePattern) throw new Error('createX402Paywall: opts.routePattern (e.g. "POST /premium") is required');

  let httpServer = null;
  let initialized = false;
  let initFailedAt = 0;
  const INIT_RETRY_MS = 60_000;

  function server() {
    if (httpServer) return httpServer;
    const facilitator = new HTTPFacilitatorClient({ url: facilitatorUrl, createAuthHeaders: createCdpAuthHeaders() });
    const resourceServer = new x402ResourceServer(facilitator).register(network, new ExactEvmScheme());
    resourceServer.registerExtension(bazaarResourceServerExtension);

    const routeConfig = {
      accepts: { scheme: 'exact', price, network, payTo, maxTimeoutSeconds: 60 },
      description,
      mimeType: 'application/json',
      ...(resource ? { resource } : {}),
      ...(discovery ? { extensions: declareDiscoveryExtension(discovery) } : {}),
    };
    httpServer = new x402HTTPResourceServer(resourceServer, { [routePattern]: routeConfig });
    return httpServer;
  }

  // The facilitator's supported-kinds sync (needed to build the 402 challenge)
  // requires CDP auth; retry on a cooldown rather than hammering it every call.
  async function ensureInitialized(s) {
    if (initialized || Date.now() - initFailedAt < INIT_RETRY_MS) return;
    try {
      await s.initialize();
      initialized = true;
    } catch (err) {
      initFailedAt = Date.now();
      logger.warn?.(`[x402-kit] facilitator sync unavailable, retrying later: ${err.message}`);
    }
  }

  return async function x402Paywall(req, res, next) {
    const s = server();
    await ensureInitialized(s);

    const path = (req.originalUrl || req.url).split('?')[0];
    const paymentHeader = req.header('payment-signature') || req.header('x-payment') || req.header('payment');

    let result;
    try {
      result = await s.processHTTPRequest({ adapter: new JsonAdapter(req), path, method: req.method, paymentHeader });
    } catch (err) {
      logger.error?.(`[x402-kit] verify failed: ${err.message}`);
      return res.status(502).json({ ok: false, error: 'x402_facilitator_error', message: err.message });
    }

    // Route isn't protected by this paywall — pass through.
    if (result.type === 'no-payment-required') return next();

    // No payment (or an invalid one) — emit the 402 challenge (PAYMENT-REQUIRED header).
    if (result.type !== 'payment-verified') return writeSdkResponse(res, result.response);

    // Verified — settle on-chain BEFORE serving so an unsettled call never runs.
    let settle;
    try {
      settle = await s.processSettlement(
        result.paymentPayload,
        result.paymentRequirements,
        result.declaredExtensions,
        { request: { adapter: new JsonAdapter(req), path, method: req.method } }
      );
    } catch (err) {
      logger.error?.(`[x402-kit] settle failed: ${err.message}`);
      return res.status(502).json({ ok: false, error: 'x402_facilitator_error', message: err.message });
    }
    if (!settle.success) return writeSdkResponse(res, settle.response);

    // A settle without a tx id can't be trusted/recorded — fail safely.
    if (!settle.transaction || typeof settle.transaction !== 'string') {
      logger.error?.(`[x402-kit] settle succeeded without a transaction id (payer=${settle.payer}); refusing to serve`);
      return res.status(502).json({ ok: false, error: 'x402_settlement_no_transaction' });
    }

    for (const [k, v] of Object.entries(settle.headers || {})) res.setHeader(k, v);
    req.x402 = { settled: true, txHash: settle.transaction, payer: settle.payer, network: settle.network || network };
    logger.info?.(`[x402-kit] settled ${price} tx=${settle.transaction} payer=${settle.payer}`);
    return next();
  };
}

export default createX402Paywall;
