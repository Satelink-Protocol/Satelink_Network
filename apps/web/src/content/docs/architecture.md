## The money path

Every metered request follows one pipeline, end to end:

```
HTTP request
  → free-tier gate        rate-limits anonymous IPs (500/day); paid keys bypass
  → RPC gateway           routes to healthy upstream providers (circuit breakers)
  → billing               deducts $0.00003/call from the caller's credit balance
  → revenue event         one immutable row per billed call (the canonical record)
  → epoch aggregation     events roll into settlement epochs (~every 10 minutes)
  → settlement batches    per-epoch payable rollups
  → RevenueVault (137)    USDT settlement target on Polygon PoS
```

Nothing on any dashboard is invented: every displayed number traces back to a
row in this pipeline or an on-chain read.

## Components

- **RPC Gateway** — the public entry point (`rpc.satelink.network`). Multi-chain
  JSON-RPC with provider health monitoring, automatic failover, and an edge
  cache. Live provider status: `/rpc/health`, `/rpc/stats/polygon`.
- **Free-tier gate** — IP-based metering for anonymous callers backed by
  Redis counters that reset at UTC midnight. Over-limit traffic receives a
  self-describing HTTP 402.
- **Credit system** — customer balances in USDT. Deposits are permissionless:
  send USDT to the RevenueVault contract and your account is credited after
  on-chain confirmation. No custodian sits between your wallet and the vault.
- **Epoch ledger** — billed events aggregate into epochs (~10-minute windows).
  Epochs produce settlement batches with the 50/30/20 revenue split applied.
- **Settlement** — batches broadcast to Polygon when funded and enabled.
  Settlement automation is currently in final verification (dry-run mode);
  the ledger aggregates continuously either way. See [Roadmap](/docs/roadmap).
- **Node network** — permissionless operators register via the node portal
  and serve routed traffic for 50% of revenue. See
  [Node Operators](/docs/node-operators).

## On-chain contracts (Polygon PoS, chain 137)

| Contract | Address |
|---|---|
| RevenueVault V2 | `0x577D3716d6Ad5b676d230f5409deF9838FABaCEF` |
| USDT (settlement token) | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` |

Both are verifiable on [Polygonscan](https://polygonscan.com/address/0x577D3716d6Ad5b676d230f5409deF9838FABaCEF).

## Design principles

1. **Truth over polish** — a metric that cannot be traced to a real query or
   an on-chain read does not ship. Empty states are honest.
2. **Permissionless both sides** — depositing capacity and serving capacity
   both work without approval from us.
3. **Machine-first onboarding** — the HTTP 402 flow means an autonomous agent
   can discover pricing, register, and pay without a human in the loop.
