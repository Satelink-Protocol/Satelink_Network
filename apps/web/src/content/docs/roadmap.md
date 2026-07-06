Kept in sync with the repository — items appear here only when they exist in
code or are explicitly planned. Nothing below is invented for marketing.

## Completed

- **RPC Gateway** — multi-chain JSON-RPC with provider health monitoring,
  circuit breakers, failover, and edge caching
- **Revenue engine** — per-call USDT metering ($0.00003), immutable revenue
  events, external/internal revenue separation
- **Credit system** — prepaid USDT balances, permissionless RevenueVault V2
  deposits, on-chain deposit listener
- **Epoch settlement pipeline** — epoch ledger, settlement batches, 50/30/20
  split accounting, first USDT claim verified on Polygon mainnet
- **Authentication** — API keys, MetaMask sign-to-create wallet-bound keys,
  HTTP 402 machine onboarding (`/v1/machine/register`)
- **Admin command center** — operator NOC with data-truth-audited metrics,
  computed health score, demand radar and conversion pipeline
- **Node & developer portals** — registration, earnings, usage metering,
  deposits consoles
- **Monitoring & status** — public status page, per-provider health API,
  measured (never fabricated) uptime/latency
- **Paperclip agent OS foundations** — machine-access control plane (hashed
  tokens, scoped auth, audit chaining)

## In progress

- **Production hardening** — settlement automation in final verification
  (dry-run mode with explicit safety gates)
- **Customer onboarding polish** — converting free-tier traffic into funded
  accounts
- **Documentation overhaul** — this portal, kept as the single source of
  truth with the GitHub Wiki as a mirror
- **Infrastructure dashboards** — deeper time-series observability

## Next milestones

- **Grow external paying customers** — the first external customer deposit
  landed in July 2026; the next milestone is repeatable conversion
- **First fully autonomous machine payment** — a machine completing the 402 →
  register → deposit → call loop with no human involvement
- **Live settlement enablement** — funded signer + revenue threshold + human
  sign-off, then automated on-chain broadcasts
- **Node operator onboarding at scale** — grow beyond the current
  single-digit node count with reputation-weighted routing
- **Multi-provider execution** — weighted routing across a larger provider
  set

## Planned (no dates committed)

- **AI inference proxy** — GPU workloads with the same metering model
- **Webhook delivery network** — reliable delivery with retries and DLQs
- **Distributed compute jobs** — serverless functions with per-second billing

Timelines for planned items depend on network growth; we deliberately do not
publish quarter commitments we can't verify.
