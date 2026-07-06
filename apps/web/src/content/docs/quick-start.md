## 1. Make a call with no key at all

The fastest way to understand Satelink is to call it. The free tier is gated
by IP, not by account:

```bash
curl -X POST https://rpc.satelink.network/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

You get a normal JSON-RPC response. Free tier: **500 calls per day per IP**
(also capped per /24 subnet). When you exceed it, the gateway answers with
**HTTP 402 Payment Required** — and the 402 body is self-contained: it tells
you (or your machine) exactly how to register and deposit to continue. See
[Machine Customers](/docs/machine-customers).

## 2. Create an API key

An API key gives you your own metered quota and a usage dashboard. One call,
no signup form:

```bash
curl -X POST https://rpc.satelink.network/api/keys \
  -H "Content-Type: application/json" \
  -d '{"label":"my-first-key","tier":"free"}'
```

The response contains your `api_key` (shown once — store it). Prefer a UI?
The [developer console](/satelink/os/keys) creates a wallet-bound key from a
single MetaMask signature.

## 3. Call with your key

```bash
curl -X POST https://rpc.satelink.network/rpc \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

## 4. Check your usage

```bash
curl https://rpc.satelink.network/api/keys/usage \
  -H "X-API-Key: YOUR_API_KEY"
```

Returns your tier, daily limit, requests today, credits spent, and credits
remaining.

## 5. Add credits (optional, for volume beyond the free tier)

Deposit USDT on Polygon PoS to the RevenueVault — permissionless, from any
wallet. $1 buys ≈ 33,333 calls at the flat metered rate of $0.00003/call:

```bash
curl "https://rpc.satelink.network/credits/initiate?amount=10"
```

The response contains the vault address, the USDT contract address, and
ready-to-send `approve` + `deposit` calldata. Credits appear after ~25 block
confirmations (about 5 minutes). Full detail: [Billing & Credits](/docs/billing).

## Supported chains

| Chain | Chain ID |
|---|---|
| Polygon PoS | 137 |
| Ethereum | 1 |
| Arbitrum | 42161 |
| Base | 8453 |
| Polygon Amoy (testnet) | 80002 |

The gateway monitors every upstream provider with health checks and circuit
breakers — see live provider status at
[rpc.satelink.network/rpc/health](https://rpc.satelink.network/rpc/health).
