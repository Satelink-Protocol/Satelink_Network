# 06 — Dashboard Inventory (by persona)

> Each persona maps to a Grafana **folder + team + service-account scope** and to
> embedded panels inside the matching Satelink OS route. Embed modes:
> **API-KPI** = native v2 StatCard fed by `/api/grafana` query (pixel-consistent);
> **iframe** = kiosk-mode signed iframe via the embed proxy.

## Developer  — folder `Developer`, route `/satelink/os/usage` + `/overview`
Identity: API key(s) / wallet. Forced filter: `{api_key_hash="<caller>"}`.

| ID | Dashboard | Embed | Key panels | Data source |
|---|---|---|---|---|
| DEV-1 | My Usage | API-KPI + iframe | my req rate, error %, p50/95/99 latency | Prometheus (`rpc_requests_total`, `rpc_request_duration_seconds`) |
| DEV-2 | Credits & Limits | API-KPI | credit burn-down, daily-limit headroom | Prometheus (`credits_balance_usdt`, `daily_limit_remaining`) |
| DEV-3 | API Key Detail | iframe | per-key rate/errors/spend, top methods, recent failures | Prometheus + Loki |
| DEV-4 | My Errors (live) | iframe | error stream filtered to my `api_key_hash`, top error codes | Loki |

SLO surface: 99.5% gateway success; p95 < target ms.

## Node Operator — folder `Node Operator`, route `/satelink/os/nodes`
Identity: `node_id` / wallet. Forced filter: `{node_id IN (my nodes)}`.

| ID | Dashboard | Embed | Key panels | Data source |
|---|---|---|---|---|
| NODE-1 | Node Health | iframe | up/heartbeat age, region latency, restarts | Prometheus (`node_up`, `node_heartbeat_age_seconds`) |
| NODE-2 | Jobs & Success | iframe | jobs served, success %, by status | Prometheus (`node_jobs_served_total`) |
| NODE-3 | Earnings | API-KPI + iframe | epoch earnings, reward accrual, reputation/eligibility | Prometheus (`node_reward_usdt_total`) + PG |
| NODE-4 | My Node Logs | iframe | node-agent error/heartbeat log stream | Loki (`{service="node-agent"}`) |

SLO surface: node uptime ≥ 99%; reward accrual.

## Distributor — folder `Distributor`, route (distributor area)
Identity: distributor account. Forced filter: child keys / pool nodes.

| ID | Dashboard | Embed | Key panels | Data source |
|---|---|---|---|---|
| DIST-1 | Pool Revenue | iframe | child-key revenue/calls, aggregated USDT | Prometheus + PG |
| DIST-2 | Pool Fleet Health | iframe | pool node fleet up/online, stragglers | Prometheus |
| DIST-3 | Conversion Funnel | iframe | referred-dev signups → active → paying | PG / Loki |

SLO surface: pool availability; settlement timeliness.

## Enterprise — folder `Enterprise`, route (enterprise area)
Identity: enterprise tier key + SLA. Forced filter: `{tier="enterprise", api_key_hash=...}`.

| ID | Dashboard | Embed | Key panels | Data source |
|---|---|---|---|---|
| ENT-1 | SLA Availability | API-KPI + iframe | availability/latency by region, error-budget burn | Prometheus (burn-rate rules) |
| ENT-2 | Rate-limit Budget | iframe | rate-limit headroom, 429s | Prometheus / Loki |
| ENT-3 | AI Gateway (`/v1`) | iframe | token throughput, per-model latency/cost | Prometheus (`ai_tokens_total`, `ai_request_duration_seconds`) |
| ENT-4 | MEV Relay | iframe | bundle submit success, relay latency, revenue uplift | Prometheus (`mev_bundles_total`) |

SLO surface: contractual SLA (e.g. 99.9%); error-budget burn-rate alerts (A14).

## Admin — folder `Admin`, route `/admin/command-center` (full embedded Grafana org)
Identity: `X-Admin-Key` / admin JWT. No tenant filter (full visibility).

| ID | Dashboard | Embed | Key panels | Maps to engine |
|---|---|---|---|---|
| ADM-1 | Gateway Overview | iframe + API-KPI | req rate, error %, p50/95/99, upstream health, cache hit | API Gateway |
| ADM-2 | Revenue & Settlement | iframe | revenue rate, USDT/epoch, settlement state, signer balance, anchor lag | Revenue + Settlement |
| ADM-3 | Treasury | iframe | balances, split distribution, payout queue depth | Treasury |
| ADM-4 | Node Fleet | iframe | all-nodes map, online count, reputation, eligibility, stragglers | Node Registry |
| ADM-5 | Demand Radar | iframe | demand scanned, jobs matched, fill ratio, connector ingest | Demand Radar |
| ADM-6 | RPC Provider Health | iframe | per-provider latency/success, circuit-breaker state, failover | API Gateway |
| ADM-7 | Logs Explorer | iframe | live error stream, filter by route_class/level/trace_id | Loki |
| ADM-8 | Trace Explorer | iframe | slow-trace search, service graph, RED by span | Tempo |
| ADM-9 | Infra Health | iframe | CPU/mem/event-loop lag, DB conns/slow queries, Redis ops, restarts | exporters |
| ADM-10 | Security & Abuse | iframe | 429 surge, free-tier abuse IPs, auth failures, admin-action audit | Prometheus + Loki |
| ADM-11 | Frontend RUM | iframe | Web Vitals (LCP/INP/CLS), route errors, browser→API latency | Prometheus (`web_vital_*`) |

SLO surface: platform SLOs + on-call (A1–A18).

---

### Engine → dashboard coverage (every named engine has an owner panel)

| Engine | Admin dashboard | Tenant-facing dashboard |
|---|---|---|
| API Gateway | ADM-1, ADM-6 | DEV-1, DEV-3 |
| Revenue Engine | ADM-2 | DEV-2, DIST-1 |
| Settlement Engine | ADM-2 | NODE-3 (earnings), DIST-1 |
| Node Registry | ADM-4 | NODE-1, NODE-2, DIST-2 |
| Demand Radar | ADM-5 | DIST-3 |
| Treasury | ADM-3 | — (admin-only) |

> Dashboards ship **as code** (JSON under `config/grafana/dashboards/<persona>/`)
> loaded by the provisioning provider in `provisioning/dashboards/dashboards.yml`.
> Authoring the JSON is Phase 5 work — not part of this review artifact.
