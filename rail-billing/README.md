# rail-billing

**Meter API calls, then charge by crypto *or* card — into one credit ledger.**

A rail-agnostic usage-billing engine for any Express API. One metering gate + one prepaid-credit ledger, funded by **any rail**:

- **x402** — machines pay per-call in USDC over HTTP, settled on-chain (Coinbase CDP facilitator). No signup, no key.
- **Stripe** — humans buy a credit pack with a card via Stripe Checkout.

Both top up the *same* ledger. A call is served free (within quota), else against a credit; when neither is available the gate answers `402` advertising every enabled rail.

```
served free (quota) ─┐
served from credits ─┼─► your handler runs
   402 dual-rail  ───┘   (x402 PAYMENT-REQUIRED header  +  Stripe checkout_url)
```

## Install

```bash
npm install rail-billing express
npm install stripe            # optional — omit to run x402-only
```

## Use

```js
import express from 'express';
import { createBillingEngine } from 'rail-billing';

const app = express();
const billing = createBillingEngine({
  freeQuota: 100,                              // free calls per caller
  x402:   { routePattern: 'POST /premium', price: '$0.01', network: 'eip155:8453', payTo: '0xYourWallet' },
  stripe: { unitAmount: 1000, creditsPerPack: 1000 },   // $10 → 1000 calls (optional)
});

// Stripe webhook needs the raw body — mount BEFORE express.json()
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), billing.stripeWebhook);
app.use(express.json());

app.post('/premium', billing.gate, (req, res) => {
  res.json({ ok: true, data: 'premium payload', billing: req.billing }); // req.billing: tier + balance
});

app.listen(3000);
```

## How a caller pays

| Caller | Path |
|---|---|
| **Autonomous agent** | gets `402` + `PAYMENT-REQUIRED` header → pays USDC via any x402 client → retries → served, credited |
| **Human / app** | gets `402` + `rails.stripe.checkout_url` → pays by card → webhook credits the account → next calls served |

Both consume the same credits. Mix freely.

## Config

`createBillingEngine({ store?, identify?, freeQuota?, creditsPerX402Payment?, x402?, stripe? })`

- `store` — ledger backend (default in-memory `MemoryStore`; implement the same async interface for Postgres/Redis).
- `identify(req)` — customer id (default `x-api-key` / `x-payer-address` / IP).
- `freeQuota` — free calls before payment is required.
- `x402` — `{ routePattern, price, network, payTo, resource?, description?, discovery? }` or omit to disable.
- `stripe` — `{ secretKey?, webhookSecret?, unitAmount, currency?, creditsPerPack, successUrl?, cancelUrl? }` or omit to disable.

Env: `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` (x402 settle), `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` (fiat). See `.env.example`.

## Why rail-agnostic

Usage-based billing is a proven category (Lago, Orb, OpenMeter) — but every incumbent settles in **fiat only**, and every crypto tool is x402-only. This engine is the billing *orchestration* — the metering + credit ledger + dual-rail funding — so you charge machines in USDC and humans by card from one integration, and you're not betting the business on either rail winning.

## Run the example

```bash
CDP_API_KEY_ID=… CDP_API_KEY_SECRET=… X402_PAY_TO=0x… npm run example
# POST /premium 6x  ->  first 5 free, then 402 with the x402 (and Stripe, if configured) rails
```

## License

MIT
