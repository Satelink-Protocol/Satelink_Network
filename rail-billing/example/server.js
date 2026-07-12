// Rail-agnostic billing in ~15 lines: free quota, then pay by crypto (x402) OR
// card (Stripe) — both top up the same credit ledger.
//
//   CDP_API_KEY_ID=… CDP_API_KEY_SECRET=… X402_PAY_TO=0xYourWallet \
//   STRIPE_SECRET_KEY=sk_test_… STRIPE_WEBHOOK_SECRET=whsec_… \
//     node example/server.js
//
// (Stripe vars optional — omit them and the engine runs x402-only.)

import express from 'express';
import { createBillingEngine } from '../src/engine.js';

const app = express();

const billing = createBillingEngine({
  freeQuota: 5,                       // first 5 calls free per caller
  identify: (req) => req.header('x-api-key') || req.ip,
  x402: process.env.X402_PAY_TO ? {
    routePattern: 'POST /premium',
    price: '$0.01',
    network: 'eip155:8453',            // Base
    payTo: process.env.X402_PAY_TO,
    resource: `${process.env.PUBLIC_URL || 'http://localhost:3000'}/premium`,
    description: 'Premium data — pay-per-call, crypto or card.',
  } : null,
  stripe: process.env.STRIPE_SECRET_KEY ? {
    unitAmount: 1000,                  // $10.00
    creditsPerPack: 1000,              // 1000 calls
  } : null,
});

// Stripe webhook must see the raw body.
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), billing.stripeWebhook);

app.use(express.json());

app.post('/premium', billing.gate, (req, res) => {
  res.json({ ok: true, data: 'your premium payload', billing: req.billing });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`rail-billing example on http://localhost:${port}`);
  console.log(`rails enabled: ${JSON.stringify(billing.rails)}`);
  console.log(`POST /premium 6x -> first 5 free, then 402 with x402 + stripe rails`);
});
