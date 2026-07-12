// Example: put an x402 paywall in front of one route in ~10 lines.
//
//   CDP_API_KEY_ID=… CDP_API_KEY_SECRET=… X402_PAY_TO=0xYourWallet \
//     node example/server.js
//
// Then:
//   curl localhost:3000/free                      -> 200, no payment
//   curl -X POST localhost:3000/premium -d '{}'   -> 402 + PAYMENT-REQUIRED header
//   (an x402 client, e.g. @x402/fetch, pays and retries automatically)

import express from 'express';
import { createX402Paywall } from '../src/paywall.js';

const app = express();
app.use(express.json());

// --- free route ---
app.get('/free', (req, res) => res.json({ ok: true, tier: 'free' }));

// --- paywalled route: $0.01 USDC on Base, per call ---
const paywall = createX402Paywall({
  routePattern: 'POST /premium',
  price: process.env.X402_PRICE || '$0.01',
  network: process.env.X402_NETWORK || 'eip155:8453', // Base
  payTo: process.env.X402_PAY_TO,                       // your wallet — set this
  resource: `${process.env.PUBLIC_URL || 'http://localhost:3000'}/premium`,
  description: 'Premium data — pay-per-call in USDC (Base) via x402.',
  // optional: makes the route discoverable in the CDP x402 Bazaar once settled
  discovery: {
    method: 'POST',
    bodyType: 'json',
    input: { query: 'example' },
    inputSchema: { properties: { query: { type: 'string' } }, required: ['query'] },
    output: { example: { ok: true, data: '…' } },
  },
});

app.post('/premium', paywall, (req, res) => {
  // Only runs AFTER a settled on-chain payment. req.x402 has the receipt.
  res.json({ ok: true, data: 'your premium payload', receipt: req.x402 });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  if (!process.env.X402_PAY_TO) console.warn('⚠  set X402_PAY_TO to your recipient wallet');
  if (!process.env.CDP_API_KEY_ID) console.warn('⚠  set CDP_API_KEY_ID / CDP_API_KEY_SECRET (Coinbase CDP) for settlement');
  console.log(`x402-kit example on http://localhost:${port}  (free: GET /free, paid: POST /premium)`);
});
