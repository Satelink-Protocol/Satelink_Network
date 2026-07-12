// Stripe (fiat) rail — sell a prepaid credit pack via Stripe Checkout; grant
// credits on the checkout.session.completed webhook. Symmetric with the x402
// rail: both fund the SAME credit ledger.
//
// `stripe` is lazy-required so the engine runs x402-only when it isn't installed.
// Install with: npm install stripe

export function buildStripeRail(cfg = {}) {
  const {
    secretKey = process.env.STRIPE_SECRET_KEY,
    webhookSecret = process.env.STRIPE_WEBHOOK_SECRET,
    unitAmount = 1000,          // cents ($10.00) per pack
    currency = 'usd',
    creditsPerPack = 1000,      // call-credits granted per pack
    productName = 'API credits',
    successUrl = process.env.STRIPE_SUCCESS_URL || 'https://example.com/success',
    cancelUrl = process.env.STRIPE_CANCEL_URL || 'https://example.com/cancel',
    stripeClient = null, // inject a client (tests); otherwise lazy-require 'stripe'
    logger = console,
  } = cfg;
  if (!secretKey && !stripeClient) throw new Error('stripe rail: secretKey (STRIPE_SECRET_KEY) is required');

  let _stripe = stripeClient;
  async function client() {
    if (_stripe) return _stripe;
    let Stripe;
    try { ({ default: Stripe } = await import('stripe')); }
    catch { throw new Error('stripe rail enabled but the "stripe" package is not installed — run: npm install stripe'); }
    _stripe = new Stripe(secretKey);
    return _stripe;
  }

  // Returns a hosted Checkout URL that tops up `customerId` by creditsPerPack.
  async function createCheckout(customerId) {
    const stripe = await client();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: customerId,
      line_items: [{
        quantity: 1,
        price_data: {
          currency,
          unit_amount: unitAmount,
          product_data: { name: `${productName} (${creditsPerPack} calls)` },
        },
      }],
      metadata: { customerId, creditsPerPack: String(creditsPerPack) },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
    return { url: session.url, id: session.id };
  }

  // Express handler. Verifies the signature, and on a completed checkout calls
  // grant(customerId, credits). Mount with express.raw({type:'application/json'}).
  async function handleWebhook(req, res, grant) {
    const stripe = await client();
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], webhookSecret);
    } catch (err) {
      logger.warn?.(`[stripe] bad webhook signature: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;
      const customerId = s.client_reference_id || s.metadata?.customerId;
      const credits = parseInt(s.metadata?.creditsPerPack || creditsPerPack, 10);
      if (customerId) {
        await grant(customerId, credits);
        logger.info?.(`[stripe] credited ${customerId} +${credits} (session ${s.id})`);
      }
    }
    return res.json({ received: true });
  }

  return { name: 'stripe', createCheckout, handleWebhook, creditsPerPack, unitAmount, currency };
}
