Satelink has exactly two prices, and one of them is zero.

## Free tier

| | |
|---|---|
| Price | $0 |
| Limit | **500 calls/day per IP** (also capped per /24 subnet) |
| Chains | All supported chains |
| Requirements | None — no account, no credit card |

The free tier is metered by source IP. When you exceed it, the gateway
returns HTTP 402 with self-contained instructions to continue as a paying
customer.

## Metered (pay-as-you-go)

| | |
|---|---|
| Price | **$0.00003 per call**, flat |
| Billing | Deducted from a prepaid USDT credit balance |
| Deposits | Permissionless, on-chain (Polygon PoS 137) |
| Expiry | Credits never expire |
| Minimum | The real current minimum is returned by `GET /credits/initiate` — we don't hardcode it in docs |

That works out to **$30 per million calls**, always, at any volume. There are
no plans, no tiers, no rate negotiations, and no "contact sales."

## What we deliberately don't have

- **No subscriptions** — old references to $9/$49/$199 monthly plans are
  obsolete; those plans no longer exist.
- **No SLA guarantees yet** — uptime and latency are *measured* and published
  live on the [status page](https://satelink.network/status), but we do not
  sell a contractual SLA at this stage. Treat the network as beta capacity
  and keep a fallback RPC for critical production paths.
