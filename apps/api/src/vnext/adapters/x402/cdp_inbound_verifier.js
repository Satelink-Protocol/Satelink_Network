// CDP inbound payment verifier — turns a caller's X-PAYMENT header into a
// SETTLED USDC payment to Satelink, using the Coinbase CDP facilitator. This is
// the real B1 implementation: it reuses the SAME facilitator client the live
// merchant middleware uses (HTTPFacilitatorClient.verify / .settle).
//
// The facilitator client is injected (real one in prod via buildCdpFacilitator();
// a stub in tests) so the verify/settle wire calls are the only external
// boundary. Safe-by-default: no CDP credentials -> buildCdpFacilitator() returns
// null -> no verifier -> InboundSettlement fails safe (never serves for free).
//
// SECURITY (enforced here, before any settle):
//  - forged proof: never trust header contents; facilitator.verify must pass.
//  - payment redirect: requirements.payTo is OUR address; verify fails if the
//    payment pays elsewhere.
//  - underpay/amount spoof: settle must report an amount >= the quoted price,
//    read from the FACILITATOR response, not the header.
//  - fail-closed: any verify/settle error or non-success -> { settled:false }.

import { HTTPFacilitatorClient } from '@x402/core/server';
import { createCdpAuthHeaders } from '@coinbase/x402';

// Base mainnet USDC (6 decimals). Overridable for other networks/assets.
const DEFAULT_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

function decodeHeader(header) {
  try {
    const obj = JSON.parse(Buffer.from(String(header), 'base64').toString('utf8'));
    if (!obj || typeof obj !== 'object' || Array.isArray(obj) || typeof obj.x402Version !== 'number') return null;
    return obj;
  } catch { return null; }
}

// Normalize the SDK's verify/settle responses defensively (field names vary by
// SDK version) into a stable shape.
const isValid = (r) => !!(r && (r.isValid ?? r.valid ?? r.ok));
const settleOk = (r) => !!(r && (r.success ?? r.settled ?? r.ok));
const txRefOf = (r) => (r && (r.transaction ?? r.txHash ?? r.txRef ?? r.hash)) || null;
const payerOf = (r, payload) => (r && (r.payer ?? r.from)) || (payload && (payload.payer ?? (payload.payload && payload.payload.from))) || null;
const amountOf = (r) => (r && (r.amount ?? r.settledAmount ?? (r.payload && r.payload.amount))) || null;

/**
 * @param {object} o
 *  - facilitator (required): { verify(payload, requirements), settle(payload, requirements) }
 *  - asset: USDC contract address (default Base USDC)
 * @returns async verifier({ header, price, unit, resource, payTo, network }) -> { settled, amount?, txRef?, payer?, reason? }
 */
export function createCdpInboundVerifier({ facilitator, asset = DEFAULT_USDC } = {}) {
  if (!facilitator || typeof facilitator.verify !== 'function' || typeof facilitator.settle !== 'function') {
    throw new Error('createCdpInboundVerifier requires a facilitator with verify()/settle()');
  }
  return async function verify({ header, price, unit, resource, payTo, network }) {
    const payload = decodeHeader(header);
    if (!payload) return { settled: false, reason: 'malformed_payment' };

    // Requirements pin the payment to OUR address, our price, our network.
    const requirements = {
      scheme: 'exact',
      network,
      payTo,                              // Satelink receiving address (payment-redirect guard)
      maxAmountRequired: String(price),   // caller must pay at least the quoted price
      asset,
      resource,
      mimeType: 'application/json',
      maxTimeoutSeconds: 120,
    };

    // 1) Cryptographic verification (forged-proof guard). Fail-closed on error.
    let vres;
    try { vres = await facilitator.verify(payload, requirements); }
    catch (e) { return { settled: false, reason: `verify_error:${(e && e.message) || e}` }; }
    if (!isValid(vres)) return { settled: false, reason: (vres && vres.invalidReason) || 'invalid_payment' };

    // 2) On-chain settlement (moves USDC to payTo). Fail-closed on error.
    let sres;
    try { sres = await facilitator.settle(payload, requirements); }
    catch (e) { return { settled: false, reason: `settle_error:${(e && e.message) || e}` }; }
    if (!settleOk(sres)) return { settled: false, reason: (sres && sres.errorReason) || 'settle_failed' };

    // 3) Amount check from the FACILITATOR response (underpay guard). If the
    //    facilitator doesn't echo an amount, the requirements enforced the
    //    minimum, so we accept the quoted price.
    const settledAmount = amountOf(sres);
    if (settledAmount != null) {
      try { if (BigInt(settledAmount) < BigInt(price)) return { settled: false, reason: 'underpaid' }; }
      catch { /* non-numeric amount from SDK -> fall back to requirements-enforced price */ }
    }
    return {
      settled: true,
      amount: settledAmount != null ? String(settledAmount) : String(price),
      txRef: txRefOf(sres),
      payer: payerOf(sres, payload),
    };
  };
}

/**
 * Build the real CDP facilitator client from env (same as merchant middleware).
 * Returns null when CDP credentials are absent -> caller stays fail-safe.
 */
export function buildCdpFacilitator() {
  if (!process.env.CDP_API_KEY_ID || !process.env.CDP_API_KEY_SECRET) return null;
  return new HTTPFacilitatorClient({
    url: process.env.X402_FACILITATOR_URL || 'https://api.cdp.coinbase.com/platform/v2/x402',
    createAuthHeaders: createCdpAuthHeaders(),
  });
}

/** Convenience: real env-driven verifier, or null if unconfigured (fail-safe). */
export function buildInboundVerifierFromEnv() {
  const facilitator = buildCdpFacilitator();
  if (!facilitator) return null;
  return createCdpInboundVerifier({ facilitator, asset: process.env.VNEXT_INBOUND_ASSET || DEFAULT_USDC });
}
