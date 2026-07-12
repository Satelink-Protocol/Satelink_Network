# x402-kit

**Charge crypto (USDC) per API call, in ~10 lines.** Drop an [x402](https://x402.org) paywall in front of any Express route — verify and settle payments on-chain through the **Coinbase CDP facilitator**. Mainnet-proven flow (the exact verify → settle → serve path used in production, with the sharp edges already filed off).

```
No payment   → 402 + PAYMENT-REQUIRED challenge header (an x402 client pays & retries)
With payment → verify → settle on-chain → your handler runs
```

Settlement happens **before** your handler executes, so an unsettled call is never served.

## Install

```bash
npm install x402-kit express
```

## Use

```js
import express from 'express';
import { createX402Paywall } from 'x402-kit';

const app = express();
app.use(express.json());

const paywall = createX402Paywall({
  routePattern: 'POST /premium',
  price: '$0.01',                 // per call
  network: 'eip155:8453',         // Base
  payTo: '0xYourWallet',          // where the money lands
});

app.post('/premium', paywall, (req, res) => {
  // only runs after a settled on-chain payment
  res.json({ ok: true, data: 'premium payload', receipt: req.x402 });
});

app.listen(3000);
```

That's it. `req.x402 = { settled, txHash, payer, network }` after a paid call.

## Environment

Set your Coinbase CDP keys (used to verify/settle):

```bash
CDP_API_KEY_ID=...          # from portal.cdp.coinbase.com
CDP_API_KEY_SECRET=...
X402_PAY_TO=0xYourWallet    # recipient
```

See `.env.example`. Get CDP keys at [portal.cdp.coinbase.com](https://portal.cdp.coinbase.com).

## Options

| Option | Default | Notes |
|---|---|---|
| `routePattern` | — (required) | e.g. `'POST /premium'` |
| `payTo` | `$X402_PAY_TO` (required) | recipient wallet |
| `price` | `'$0.01'` | per call; CDP floor is `$0.001` |
| `network` | `eip155:8453` | Base (USDC). CAIP-2 chain id |
| `facilitatorUrl` | Coinbase CDP | swap for any x402 facilitator |
| `resource` | — | public URL of the route (for Bazaar discovery) |
| `description` | generic | what the buyer gets |
| `discovery` | — | `{ method, bodyType, input, inputSchema, output }` → lists the route in the CDP x402 Bazaar after first settlement |

## Run the example

```bash
CDP_API_KEY_ID=… CDP_API_KEY_SECRET=… X402_PAY_TO=0xYourWallet npm run example
# GET  /free      -> 200 (no payment)
# POST /premium   -> 402 + PAYMENT-REQUIRED header  (pay with @x402/fetch to get 200)
```

## Paying (client side)

Any x402 v2 client works. With [`@x402/fetch`](https://www.npmjs.com/package/@x402/fetch):

```js
import { wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { privateKeyToAccount } from 'viem/accounts';
import { ExactEvmScheme } from '@x402/evm';

const pay = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: 'eip155:8453', client: new ExactEvmScheme(privateKeyToAccount('0x…')) }],
});
await pay('https://your.api/premium', { method: 'POST', body: '{}' });
```

## What you're getting

The hard part of x402 isn't the concept — it's the CDP facilitator integration: auth header signing, the `initialize()` supported-kinds sync, the `$0.001` amount floor, the v1-vs-v2 client mismatch, replay-safe settlement (settle-before-serve, no-tx-id guard), and the Bazaar discovery declaration. This kit ships all of it, working, so you don't spend a week discovering them.

## License

MIT
