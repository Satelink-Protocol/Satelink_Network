// rail-billing — a rail-agnostic usage-billing engine.
//
// One credit ledger + one metering gate, funded by ANY rail (x402 crypto and/or
// Stripe fiat). A call is served free (within quota), or against a prepaid
// credit; when neither is available the gate answers 402 advertising every
// enabled rail — an x402 client pays via the PAYMENT-REQUIRED header, a human
// pays via the Stripe checkout URL — and both top up the same ledger.
//
//   import { createBillingEngine } from 'rail-billing';
//   const billing = createBillingEngine({ freeQuota: 100, x402: {...}, stripe: {...} });
//   app.post('/premium', billing.gate, (req, res) => res.json({ data: '…', billing: req.billing }));
//   app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), billing.stripeWebhook);

import { MemoryStore } from './store.js';
import { buildX402Rail } from './x402-rail.js';
import { buildStripeRail } from './stripe-rail.js';

function writeSdkResponse(res, response) {
  res.status(response.status || 402);
  for (const [k, v] of Object.entries(response.headers || {})) res.setHeader(k, v);
  return response;
}

export function createBillingEngine(config = {}) {
  const {
    store = new MemoryStore(),
    identify = (req) => req.header('x-api-key') || req.header('x-payer-address') || req.ip,
    freeQuota = 100,
    creditsPerX402Payment = null, // default: use x402 rail's discovery/bundle intent; else 1000
    x402: x402Cfg = null,
    stripe: stripeCfg = null,
    logger = console,
  } = config;

  const x402 = x402Cfg ? buildX402Rail({ logger, ...x402Cfg }) : null;
  const stripe = stripeCfg ? buildStripeRail({ logger, ...stripeCfg }) : null;
  const x402Bundle = creditsPerX402Payment || 1000;

  async function serveFromBalance(id) {
    const used = await store.incrUsage(id);
    if (used <= freeQuota) return { tier: 'free', free_remaining: freeQuota - used };
    if (await store.debit(id, 1)) return { tier: 'paid', credits_remaining: await store.getCredits(id) };
    return null; // out of free quota and credits
  }

  async function dualRail402(req, res, id) {
    const body = { error: 'payment_required', message: 'Free quota exhausted. Top up via any rail below.', rails: {} };
    let headers = {};
    if (x402) {
      try {
        const r = await x402.process(req); // no payment header -> challenge
        if (r.type === 'challenge' && r.response) {
          headers = r.response.headers || {};
          body.rails.x402 = { scheme: 'x402', how: 'retry this request with an x402 payment header (PAYMENT-REQUIRED)' };
        }
      } catch (e) { logger.warn?.(`[engine] x402 challenge failed: ${e.message}`); }
    }
    if (stripe) {
      try {
        const { url } = await stripe.createCheckout(id);
        body.rails.stripe = { scheme: 'stripe', checkout_url: url, credits: stripe.creditsPerPack };
      } catch (e) { logger.warn?.(`[engine] stripe checkout failed: ${e.message}`); }
    }
    res.status(402);
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    return res.json(body);
  }

  async function gate(req, res, next) {
    const id = identify(req);

    // Rail 1: an x402 payment is attached — verify, settle, credit, serve.
    const hasX402Payment = x402 && (req.header('payment-signature') || req.header('x-payment') || req.header('payment'));
    if (hasX402Payment) {
      let r;
      try { r = await x402.process(req); }
      catch (e) { logger.error?.(`[engine] x402 error: ${e.message}`); return res.status(502).json({ error: 'x402_facilitator_error', message: e.message }); }
      if (r.type === 'settled') {
        await store.addCredits(id, x402Bundle);         // grant the bundle…
        await store.debit(id, 1);                        // …consume this call
        req.billing = { tier: 'x402', payer: r.payer, txHash: r.txHash, network: r.network, credits_remaining: await store.getCredits(id) };
        return next();
      }
      // invalid/failed payment → emit the challenge response as-is
      writeSdkResponse(res, r.response);
      return res.json(r.response.body || {});
    }

    // Rail 2: serve from free quota or prepaid credits.
    const served = await serveFromBalance(id);
    if (served) { req.billing = served; return next(); }

    // Rail 3: nothing left — advertise every enabled rail.
    return dualRail402(req, res, id);
  }

  // Mount at your Stripe webhook path with express.raw({type:'application/json'}).
  async function stripeWebhook(req, res) {
    if (!stripe) return res.status(404).json({ error: 'stripe rail not configured' });
    return stripe.handleWebhook(req, res, (id, credits) => store.addCredits(id, credits));
  }

  return { gate, stripeWebhook, ledger: store, rails: { x402: !!x402, stripe: !!stripe } };
}

export { MemoryStore } from './store.js';
export default createBillingEngine;
