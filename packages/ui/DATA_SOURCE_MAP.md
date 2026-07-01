# DATA SOURCE MAP — per-panel honesty audit

Every dashboard panel and its data source. Legend:
- **real endpoint** — value traces to a live API response (including honest
  zeros / $0.00003-scale values).
- **empty-by-design** — no data source exists; the panel renders `<EmptyState>`
  and is marked in code with `// TODO: no data source yet — empty by design`.
- **config-fact** — deploy-time truth (e.g. `SETTLEMENT_DRY_RUN=1`), not a metric.

All `/api/admin-proxy` calls forward to the admin API (`X-Admin-Token` server-side);
paths below are the upstream admin endpoints.

## Developer OS — Mission Control (`/satelink/os/mission-control`)

| Panel | Source |
| :-- | :-- |
| KPI: Real Revenue (MTD) | real endpoint — `/api/financial/truth` → `metered_value_usdt` |
| KPI: API Requests (24h) | real endpoint — admin `/executive/summary` → `total_requests_24h` |
| KPI: Active IPs (24h) | real endpoint — admin `/executive/summary` → `active_ips_24h` |
| KPI: Settlement Batches | real endpoint — `/api/financial/truth` → settlement batches confirmed |
| KPI sparklines | **removed** — previously padded with 6 invented zero datapoints; no history endpoint exists, so no sparkline renders |
| Gateway Traffic timeseries | **empty-by-design** — no request-history endpoint (only 24h totals); previously charted fabricated zeros for 6 prior days |
| Warnings AlertBand | real endpoint — `/api/financial/truth` → `warnings[]` |
| StatRow (health / customers / alerts / settlement mode) | real endpoint — admin `/executive/summary` |
| Revenue Pipeline rows | real endpoint — `/api/financial/truth` → `pipeline`, `/api/economics/summary` |
| Quick Start | static content (RPC URL, chain id) — not a metric |

## Developer OS — other views

| View | Source |
| :-- | :-- |
| Keys (`/satelink/os/keys`) | real endpoints — `/api/keys`, `/api/keys/usage` |
| Usage (`/satelink/os/usage`) | real endpoints — key-scoped usage APIs |
| Deposit (`/satelink/os/deposit`) | real endpoints — `/credits/deposit/initiate` flow |
| Monitoring (`/satelink/os/monitoring`) | real endpoints — `/api/status`, `/api/treasury/status`, `/rpc/health`, `/stats/free-tier`; GrafanaPanel embeds probe `/api/grafana/*` and degrade to EmptyState ("Monitoring Coming Soon") when Grafana is unconfigured — **empty-by-design** until Grafana ships |

## Admin — Command Center (`/admin/command-center`, 15 tabs)

| Tab / panel group | Source |
| :-- | :-- |
| Executive summary KPIs | real endpoint — admin `/executive/summary` |
| Revenue (summary, events, funnel) | real endpoints — admin `/revenue/summary`, `/revenue/events`, `/revenue/funnel` |
| Demand / lead pipeline | real endpoints — admin `/demand/stats`, `/intel/developers` (paginated), `/intel/abuse-overview`, `/intel/classify` |
| Network / nodes | real endpoints — admin `/network/health`, `/nodes/list` |
| Billing credits | real endpoint — admin `/billing/credits` |
| Treasury | real endpoint — admin `/treasury/status` |
| Customers | real endpoint — admin `/customers/list` |
| Agents | real endpoint — admin `/agents/status` |
| Security (threats, classifier) | real endpoints — admin `/security/threats`, `/security/classifier-stats` |
| Observability metrics | real endpoint — admin `/observability/metrics` |
| Incidents / audit log / config | real endpoints — admin `/incidents`, `/audit-log`, `/config` |
| Jobs | real endpoints — admin `/jobs/status`, `/jobs/trigger/:id` |
| Settlement | real endpoints — admin `/settlement/status`, `/settlement/dry-run` |
| Outreach (email/discord) | real endpoints — admin `/email/send`, `/outreach/discord/post` (action forms, not metrics) |
| Revenue projection chart | labeled **scenario projection** ("1/3/7 customers" price-math), not presented as a live metric |

## Admin — legacy overview (`/admin` route group)

| Panel | Source |
| :-- | :-- |
| Overview stats | real endpoints — `/api/revenue`, `/api/nodes?status=active` |
| Sub-pages (ledger, epochs, users, security…) | real endpoints via admin proxy; tables render EmptyState when the API returns zero rows |

## Node portal (`/node`, 9 views)

| Panel | Source |
| :-- | :-- |
| Node stats / earnings / claim | real endpoints — `/api/nodes/*` (network has **1 registered node**; tables honestly show 1 row) |
| Views without backing data | EmptyState via shared primitives |

## Machine portal (`/machine`, 9 views)

| Panel | Source |
| :-- | :-- |
| Machine economy views | real endpoints via `/api/*`; zero-row responses render EmptyState |

## Ops (`/ops/*`)

Redirect-only shell — themed via tokens; no new pages, no panels.

## Public status (`/status`)

| Row | Source |
| :-- | :-- |
| RPC Gateway | real endpoint — live probe of `https://rpc.satelink.network/health` every 30s ("checking" → zinc until first probe resolves) |
| Billing System | derived — same backend process as the gateway probe |
| Settlement Engine | config-fact — `SETTLEMENT_DRY_RUN=1` → violet DRY_RUN pill |
| Polygon Mainnet | derived — gateway health implies upstream chain reachability |

## Forbidden values

`1878`, `642.83`, `1482` (and any other invented metric) appear **nowhere** in
`packages/ui/src` or the app pages — enforced by grep in CI-of-one before every
commit on this branch.
