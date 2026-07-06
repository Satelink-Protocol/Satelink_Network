The admin command center is the operator-facing NOC for the platform. It is
**not customer-facing** — access requires the operator token — but its design
principles are public because they explain the numbers you see everywhere
else.

## Data-truth policy

Every metric in the command center traces to a real SQL query against the
production database or an on-chain read:

- Traffic counters come from Redis counters that reset at UTC midnight, with
  a `last_seen`-filtered database fallback — never from stale accumulators.
- Revenue is split **external vs internal**: usage metered against the
  platform's own keys is labeled internal and never presented as customer
  revenue.
- The network health score is **computed** — node availability minus
  penalties for unfunded signer, blocked settlement batches, and dry-run
  mode — with the formula displayed. It cannot read 100% while a critical
  alert is active.
- Where no backend exists for a panel, the panel shows an honest empty state
  instead of a placeholder number.

## Surfaces

| View | What it shows |
|---|---|
| Executive Overview | Revenue (external/internal), live traffic, health score, alert stack with unblock conditions |
| Demand Radar | Classified traffic (developer / machine / scanner), conversion funnel |
| Customer Ops | Paying wallets and the active free-tier conversion pipeline |
| Treasury | Settlement mode, signer state, batch accounting, on-chain contract references |
| Network / Nodes | Provider health, registered node performance |
| Observability | Database/Redis probes, API latency percentiles |

## Settlement controls

Settlement state is visible on every admin view (a persistent banner while in
dry-run). Enabling live settlement is deliberately manual and multi-gated:
funded signer, real external revenue above the safety threshold, and an
explicit human confirmation. It can never be flipped autonomously.
