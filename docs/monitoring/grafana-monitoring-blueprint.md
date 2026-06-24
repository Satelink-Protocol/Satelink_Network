# Satelink Monitoring Blueprint — Embedded Grafana (Option B)

> Status: **DESIGN ONLY — do not implement.** This is the complete blueprint to
> review and approve before any monitoring code or infra is written.
> Decision: **Option B — Embedded Grafana** (Grafana LGTM stack embedded inside
> the Satelink OS + Admin dashboards), replacing the self-hosted SigNoz trial in
> `signoz/`.

---

## 1. Decision context & current state

**What we're replacing.** `signoz/` is a full self-hosted SigNoz clone (Go,
ClickHouse-backed). Option B drops it in favour of the Grafana **LGTM** stack:
**L**oki (logs), **G**rafana (visualisation), **T**empo (traces), **M**imir or
Prometheus (metrics). Rationale: native iframe embedding + signed-URL + API that
fits our existing Next.js dashboards, mature multi-tenancy (per-persona scoping),
and Grafana Cloud as a managed option so we don't operate ClickHouse.

**What already exists (reuse, don't rebuild):**

| Capability | Where | Notes |
|---|---|---|
| Prometheus client | `prom-client@15` (apps/api) | default process metrics + custom |
| Network metrics | `apps/api/src/workloads/rpc_gateway/metrics.js` | `/rpc/metrics` (JSON) + `/rpc/metrics/prometheus` (text) |
| Structured logs | `pino@10` JSON to stdout | Railway captures stdout → ship to Loki |
| Scoped metrics API | `machine-access` `/observability/metrics` | guarded by `read:metrics` scope |
| Counters / state | Redis (`rpc:requests:<date>`, `rpc:cache_hits:<date>`), circuit breaker, cache, health monitor, WS stats | snapshot sources |
| Revenue truth | Postgres `revenue_events_v2`, `epoch_ledger` | billing/settlement metrics |
| Frontend proxy | `next.config.ts` rewrites `/metrics`, `/metrics/json` → API | path already wired |

**Gaps to close (called out, designed below, implemented later):**
1. **No distributed tracing.** No OpenTelemetry SDK → Tempo has no trace source yet.
2. **No log shipper.** pino → stdout exists, but nothing forwards to Loki.
3. **No tenant label model.** Metrics aren't yet labelled by `api_key`/`wallet`/
   `node_id`/`tier`, which per-persona scoping requires.
4. **No Grafana, no auth bridge.** No embed proxy maps Satelink identity → Grafana.

---

## 2. Target architecture

```
                              SATELINK MONITORING — EMBEDDED GRAFANA (Option B)

  ┌────────────────────────── DATA SOURCES (Railway / Vercel) ──────────────────────────┐
  │                                                                                       │
  │  apps/api (Express, Railway)            apps/web (Next.js, Vercel)     node-agents    │
  │  ├─ prom-client  ──/metrics──┐          ├─ Web Vitals ──┐             ├─ node /metrics│
  │  ├─ pino JSON ──stdout──┐    │          └─ pino/console ─┤             └─ heartbeat    │
  │  └─ OTel SDK ─traces─┐  │    │                           │                  │         │
  │        (NEW)         │  │    │                           │                  │         │
  └─────────────────────┼──┼────┼───────────────────────────┼──────────────────┼─────────┘
                        │  │    │                           │                  │
            traces(OTLP)│  │log │ scrape(Prom)        logs  │            scrape │
                        ▼  ▼    ▼                           ▼                  ▼
  ┌──────────────────────────── COLLECTION TIER ────────────────────────────────────────┐
  │   Grafana Alloy / OTel Collector  (single agent: receives OTLP, scrapes Prom,        │
  │   tails logs, attaches tenant labels: tier, api_key_hash, wallet, node_id, region)   │
  └───────────┬──────────────────────┬─────────────────────────┬─────────────────────────┘
              │ remote_write         │ push                     │ OTLP
              ▼                      ▼                          ▼
        ┌───────────┐         ┌───────────┐              ┌───────────┐
        │ Prometheus│         │   Loki    │              │   Tempo   │   (LGTM backend —
        │ / Mimir   │         │  (logs)   │              │ (traces)  │    Grafana Cloud
        │ (metrics) │         └───────────┘              └───────────┘    OR self-host)
        └─────┬─────┘               │                          │
              └───────── exemplars / trace-to-logs / logs-to-trace correlation ──────────┐
                                    │                          │                         │
                                    ▼                          ▼                         ▼
  ┌──────────────────────────────── GRAFANA ─────────────────────────────────────────────┐
  │  Orgs/Teams per persona · RBAC · folders · provisioned dashboards · Unified Alerting   │
  │  Data source permissions + label-enforcement (per-tenant query isolation)             │
  └───────────┬───────────────────────────────────────────────────────────────┬──────────┘
              │ signed iframe / API                                            │ alerts
              ▼                                                                ▼
  ┌──────────────── EMBED LAYER (Next.js) ────────────────┐          ┌──────────────────┐
  │  /api/grafana/* authenticated proxy (BFF)             │          │ Alertmanager →   │
  │  • verifies Satelink JWT / API key / admin key        │          │ Discord, PagerDuty│
  │  • mints scoped Grafana token / signed embed URL      │          │ email, webhook    │
  │  • injects tenant var (api_key/wallet/node_id)        │          └──────────────────┘
  │  • strips Grafana cookies; enforces row/label filter  │
  └───────────┬───────────────────────────────────────────┘
              ▼
  ┌──────────────────────────────────────────────────────┐
  │  Satelink OS (@satelink/ui DashboardShell)            │
  │  <GrafanaPanel/> embedded panels in DashboardSection  │
  │  Developer · Node Operator · Distributor · Enterprise │
  │  Admin Command Center (full Grafana org)              │
  └──────────────────────────────────────────────────────┘
```

**Principle: Grafana is the metrics/alert engine; the Satelink dashboards stay the
chrome.** Embedded panels render inside the existing `@satelink/ui` DashboardShell
so the design system from v2 is preserved — Grafana is never the top-level UX for
non-admin personas.

---

## 3. Signal taxonomy — what flows where

### 3.1 Prometheus (metrics) — the "is it healthy / how much" plane
Scraped from `/rpc/metrics/prometheus`, `prom-client` defaults, node-agent
`/metrics`, and Web Vitals. Stored in Prometheus (self-host) or Mimir (cloud).
Retention: 15d high-res local, 13mo downsampled in Mimir/Cloud.

### 3.2 Loki (logs) — the "what exactly happened" plane
pino JSON from API stdout (Railway log drain → Alloy → Loki). Labels kept LOW
cardinality (`service`, `route_class`, `level`, `env`); high-cardinality IDs
(`api_key_hash`, `tx_hash`, `request_id`) stay as log *fields*, not labels.
Retention: 30d hot, 90d cold (object store).

### 3.3 Tempo (traces) — the "where is the latency" plane *(NEW instrumentation)*
OpenTelemetry SDK on the API auto-instruments Express + pg + ioredis + http
(outbound RPC to Polygon upstreams). Trace context propagated through the
gateway → upstream provider → billing → settlement path. Sampling: 100% of
errors + slow (>p95), 5–10% tail of the rest. Exemplars link Prometheus
histograms → Tempo traces; `trace_id` in pino logs links Loki ↔ Tempo.
Retention: 7–14d.

### 3.4 Correlation
- Metric → Trace: histogram exemplars (`rpc_request_duration_seconds`).
- Log → Trace: `trace_id`/`span_id` fields in every pino line.
- Trace → Log: Tempo "logs for this span" via shared `request_id`.

---

## 4. Multi-tenancy & label model (the core design constraint)

Per-persona scoping is the hardest requirement: **a Developer must only ever see
their own keys' data; a Node Operator only their nodes.** Two enforcement layers:

1. **Label/field model** — every billable/observable event carries:
   `tier` (free/basic/pro/enterprise/distributor), `api_key_hash` (sha256, never
   the raw key), `wallet`, `node_id`, `region`, `chain`, `route_class`.
   Low-cardinality ones become metric labels; identity ones are query-filtered.
2. **Query isolation at the embed proxy** — the BFF injects a forced label filter
   (e.g. `{api_key_hash="<caller>"}`) into the Grafana dashboard variable and uses
   a **per-tenant Grafana token with a data-source label policy**, so a tampered
   client query still can't read another tenant. Admin org bypasses the filter.

> Cardinality guardrail: do NOT label Prometheus series by raw `api_key`/`wallet`
> (unbounded). Per-tenant developer metrics come from **recording rules** keyed on
> `api_key_hash` with a bounded top-N, plus on-demand Loki/SQL for the long tail.

---

## 5. Persona monitoring requirements

| Persona | Identity | Primary questions | Key signals | SLO surface |
|---|---|---|---|---|
| **Developer** | API key(s) / wallet | "Are my calls succeeding? How much am I spending? Am I near my limit?" | request rate/errors by key, p50/p95/p99 latency, credits burn-down, daily-limit headroom, top error codes | 99.5% gateway success; <X ms p95 |
| **Node Operator** | `node_id` / wallet | "Is my node healthy & earning? Uptime, jobs served, rewards?" | node up/heartbeat age, jobs served, success rate, region latency, epoch earnings, reputation/eligibility | node uptime ≥99%; reward accrual |
| **Distributor** | distributor account | "Health & revenue across my sub-accounts/pool" | aggregated calls & revenue by child key, pool node fleet health, conversion of referred devs | pool availability; settlement timeliness |
| **Enterprise** | enterprise tier key + SLA | "Am I getting my SLA? Dedicated capacity, MEV relay, AI gateway usage" | SLA latency/availability per region, rate-limit budget, MEV relay success, `/v1` token usage & cost, error budget burn | contractual SLA (e.g. 99.9%) |
| **Admin** | `X-Admin-Key` / admin JWT | "Whole platform: revenue truth, settlement, fleet, incidents, security" | everything + settlement engine state, signer balance, epoch anchoring, free-tier abuse, security alerts, infra (CPU/mem/DB/Redis) | platform SLOs + on-call |

Each persona maps to a Grafana **folder + team + provisioned dashboard set**, and
to embedded panels inside the matching Satelink OS route (Developer→/usage &
/overview, Node Operator→/nodes, Admin→command-center).

---

## 6. Embedding strategy

Three mechanisms; we use a **hybrid: authenticated proxy as the gate, signed
iframe for render, Grafana API for bespoke widgets.**

### 6.1 Authenticated proxy (PRIMARY — the security boundary)
A Next.js route handler `/api/grafana/*` (BFF) is the only thing that talks to
Grafana. It:
- verifies the Satelink principal (JWT / `X-API-Key` / `X-Admin-Key`);
- resolves persona → Grafana org/team + allowed dashboards;
- mints a short-lived, **scoped** Grafana token (service-account/JWT auth) or a
  signed embed URL with the tenant variable pre-bound;
- forces the tenant label filter and strips Grafana session cookies so the
  browser never holds Grafana credentials;
- rate-limits and audit-logs every embed grant.

### 6.2 iframe embedding (PRIMARY — the render path)
Grafana **shared/public dashboards** or panels in **kiosk mode** (`&kiosk`)
embedded via `<iframe>` using the signed URL from the proxy. A small
`<GrafanaPanel dashboardUid slug vars/>` React component in `@satelink/ui` wraps
the iframe, themes it (`&theme=dark`), and sizes it inside a `DashboardSection`.
Use `allow-same-origin`-restricted sandboxing; CSP `frame-src` allows only the
Grafana origin (or same-origin if proxied). No `embed.allow_embedding` to the
open web — embedding is gated by the proxy.

### 6.3 Grafana HTTP API integration (SECONDARY — bespoke + provisioning)
For widgets that must match the `@satelink/ui` look exactly (e.g. a StatCard fed
by a single Prometheus value) the BFF calls Grafana's
`/api/ds/query` (or queries Prometheus/Loki directly) and renders with native v2
primitives — no iframe. Also used for **dashboard provisioning as code**
(`/api/dashboards/db`), alert rule sync, and snapshot/export.

**Recommendation:** non-admin personas get **API-fed native StatCards** for the
KPI strip (pixel-consistent with v2) + **iframe panels** for charts/tables; Admin
Command Center gets a **full embedded Grafana org** (richest, least custom work).

---

## 7. Deployment topology

**Recommended: Grafana Cloud (managed LGTM) + Grafana Alloy collector on Railway.**
- Lowest ops burden (no ClickHouse/Cortex to run, unlike the SigNoz path).
- Alloy runs as a small Railway service: receives OTLP, scrapes API `/metrics`,
  ingests Railway log drains, `remote_write`s to Cloud.
- Per-tenant isolation via Cloud access policies + the embed proxy.
- Cost scales with active series / log GB / trace GB — bounded by the cardinality
  guardrail in §4.

**Alternative: fully self-hosted on Railway/Fly** (Prometheus + Loki + Tempo +
Grafana OSS containers, object storage on R2/S3). Lower $, higher ops. Viable
later; start managed to ship the blueprint fast.

```
Railway project
 ├─ satelink-api            (exists)  → exposes /metrics, OTLP out, stdout logs
 ├─ alloy-collector         (NEW)     → scrape + receive + ship to Grafana Cloud
 ├─ Postgres, Redis         (exist)   → scraped via exporters (postgres/redis_exporter)
Vercel
 └─ apps/web                (exists)  → /api/grafana/* embed proxy (BFF)
Grafana Cloud
 └─ Prometheus/Mimir · Loki · Tempo · Grafana (orgs/teams/folders) · Alertmanager
External alert sinks: Discord (exists), email, PagerDuty/Opsgenie (enterprise on-call)
```

---

## 8. Dashboard inventory

| # | Dashboard | Folder / persona | Embed mode | Key panels |
|---|---|---|---|---|
| D1 | **Gateway Overview** | Platform / Admin | iframe + API KPIs | req rate, error %, p50/95/99, upstream health, cache hit |
| D2 | **Developer Usage** | Developer | API KPIs + iframe (tenant-scoped) | my calls, my errors, latency, credit burn-down, limit headroom |
| D3 | **API Key Detail** | Developer | iframe | per-key rate/errors/spend, top methods, recent failures (Loki) |
| D4 | **Node Operator** | Node Operator | iframe (node-scoped) | node up/heartbeat, jobs served, success %, region latency, earnings |
| D5 | **Node Fleet (Admin)** | Admin | iframe | all nodes map, online count, reputation, eligibility, stragglers |
| D6 | **Distributor Pool** | Distributor | iframe | child-key revenue/calls, pool fleet health, conversion funnel |
| D7 | **Enterprise SLA** | Enterprise | iframe + API | SLA availability/latency by region, error-budget burn, MEV/AI usage |
| D8 | **Revenue & Settlement** | Admin | iframe | revenue_events rate, USDT/epoch, settlement state, signer balance, anchor lag |
| D9 | **RPC Provider Health** | Admin | iframe | per-provider latency/success, circuit-breaker state, failover events |
| D10 | **AI Gateway (`/v1`)** | Admin/Enterprise | iframe | token throughput, per-model latency/cost, error rate |
| D11 | **MEV Relay** | Admin/Enterprise | iframe | bundle submit success, relay latency, revenue uplift |
| D12 | **Logs Explorer** | Admin | iframe (Loki) | live error stream, filter by route_class/level/trace_id |
| D13 | **Trace Explorer** | Admin | iframe (Tempo) | slow-trace search, service graph, RED by span |
| D14 | **Infra Health** | Admin | iframe | API CPU/mem/event-loop lag, DB conns/slow queries, Redis ops, Railway restarts |
| D15 | **Security & Abuse** | Admin | iframe | rate-limit 429s, free-tier abuse IPs, auth failures, admin-action audit |
| D16 | **Frontend RUM** | Admin | iframe | Web Vitals (LCP/INP/CLS), route errors, API call latency from browser |

---

## 9. Metrics inventory

> Names below combine **existing** (from `rpc_gateway/metrics.js`, prom-client,
> Redis counters, `revenue_events_v2`/`epoch_ledger`) and **proposed (NEW)** where
> there's a gap. Histograms suffixed `_seconds`/`_bytes`; counters `_total`.

### 9.1 Gateway / RPC (RED)
| Metric | Type | Labels | Source |
|---|---|---|---|
| `rpc_requests_total` | counter | `chain,method,status,tier,route_class` | NEW (from Redis `rpc:requests:*`) |
| `rpc_request_duration_seconds` | histogram | `chain,method,route_class` | NEW (exemplars→Tempo) |
| `rpc_errors_total` | counter | `chain,method,error_code` | NEW |
| `rpc_cache_hits_total` / `rpc_cache_hit_ratio` | counter/gauge | `chain` | exists (`rpc:cache_hits:*`, cache stats) |
| `rpc_upstream_latency_seconds` | histogram | `provider,chain` | exists (health_monitor) |
| `rpc_circuit_breaker_state` | gauge | `provider` (0 closed/1 open/2 half) | exists (circuit_breaker) |
| `rpc_provider_up` | gauge | `provider,chain` | exists (health_monitor) |
| `ws_connections_active` | gauge | — | exists (ws_gateway) |

### 9.2 Billing / revenue / settlement
| Metric | Type | Labels | Source |
|---|---|---|---|
| `billing_events_total` | counter | `tier,source_type` | `revenue_events_v2` |
| `billing_usdt_total` | counter | `tier,chain` | `revenue_events_v2.amount_usdt` |
| `credits_balance_usdt` | gauge | `api_key_hash` (top-N) | api_credits |
| `daily_limit_remaining` | gauge | `api_key_hash` (top-N) | api_usage_daily |
| `epoch_active_id` | gauge | — | `epoch_ledger` |
| `settlement_dry_run` | gauge | — | settlement status |
| `settlement_signer_balance_pol` | gauge | — | settlement status |
| `settlements_total` | counter | `status` | epoch anchor |
| `settlement_anchor_lag_seconds` | gauge | — | NEW (now − last anchor) |

### 9.3 Nodes
| Metric | Type | Labels | Source |
|---|---|---|---|
| `active_nodes` | gauge | `region,tier` | exists (`active_nodes`) |
| `node_up` | gauge | `node_id,region` | NEW (heartbeat age threshold) |
| `node_heartbeat_age_seconds` | gauge | `node_id` | NEW |
| `node_jobs_served_total` | counter | `node_id,status` | NEW (from execution_* counters) |
| `execution_provider_total` / `execution_community_total` / `execution_genesis_total` | counter | — | exists |
| `node_reward_usdt_total` | counter | `node_id` | NEW (settlement split) |

### 9.4 Workload economy / guards
| Metric | Type | Source |
|---|---|---|
| `jobs_rejected_low_margin_total` / `jobs_rejected_profit_guard_total` | counter | exists (profitProtection) |
| `connector_jobs_ingested_total` / `connector_errors_total` / `connector_runtime_ms` | counter/histogram | exists |

### 9.5 AI gateway / MEV
| Metric | Type | Labels | Source |
|---|---|---|---|
| `ai_tokens_total` | counter | `model,direction` | NEW (`/v1`) |
| `ai_request_duration_seconds` | histogram | `model` | NEW |
| `mev_bundles_total` | counter | `status` | NEW (MEV relay) |

### 9.6 Infra / runtime (prom-client defaults + exporters)
`process_cpu_seconds_total`, `nodejs_eventloop_lag_seconds`,
`nodejs_heap_size_used_bytes`, `http_request_duration_seconds`,
`pg_stat_*` (postgres_exporter), `redis_*` (redis_exporter), Railway restart count.

### 9.7 Frontend RUM
`web_vital_lcp_seconds`, `web_vital_inp_seconds`, `web_vital_cls`,
`frontend_api_duration_seconds{route}`, `frontend_errors_total{route}`.

### 9.8 Logs (Loki) & traces (Tempo) inventory
- **Loki streams:** `{service="api",route_class,level,env}` — fields: `request_id,
  trace_id, api_key_hash, wallet, node_id, tx_hash, msg`. Streams for `settlement`,
  `security`, `admin-audit`, `node-agent`.
- **Tempo spans:** `http.server` (gateway), `rpc.upstream.call`, `db.query`,
  `redis.cmd`, `billing.deduct`, `settlement.anchor`. Service graph: web → api →
  {polygon upstreams, pg, redis} → settlement.

---

## 10. Alert inventory

| # | Alert | Source | Condition (illustrative) | Severity | Route |
|---|---|---|---|---|---|
| A1 | Gateway error rate high | Prom | `rpc_errors_total:ratio > 2%` 5m | P1 | PagerDuty + Discord |
| A2 | Gateway p95 latency high | Prom | `rpc_request_duration_seconds:p95 > SLO` 10m | P2 | Discord |
| A3 | Upstream provider down | Prom | `rpc_provider_up == 0` 2m | P2 | Discord |
| A4 | Circuit breaker open | Prom | `rpc_circuit_breaker_state == 1` 1m | P2 | Discord |
| A5 | API instance down / restart loop | Prom/Railway | `up == 0` 1m or restarts>3/10m | P1 | PagerDuty |
| A6 | Event-loop lag | Prom | `nodejs_eventloop_lag_seconds > 0.5` 5m | P3 | Discord |
| A7 | DB saturation / slow queries | exporter | conns>90% or slow-query spike | P2 | Discord |
| A8 | Redis unreachable | exporter | `redis_up == 0` | P1 | PagerDuty |
| A9 | Settlement anchor stalled | Prom | `settlement_anchor_lag_seconds > 1800` | P1 | PagerDuty (revenue) |
| A10 | Signer balance low | Prom | `settlement_signer_balance_pol < threshold` | P2 | Discord |
| A11 | Live settlement enabled | Prom/log | `settlement_dry_run == 0` transition | P2 (awareness) | Discord + admin audit |
| A12 | Node fleet shrink | Prom | `active_nodes` drop >X% 10m or →0 | P2 | Discord |
| A13 | Node operator: my node down | Prom | `node_up{node_id} == 0` 5m | P2 | operator webhook/email |
| A14 | Enterprise SLA error-budget burn | Prom | burn-rate (fast+slow) on SLO | P1 | enterprise on-call |
| A15 | Rate-limit / abuse spike | Prom/Loki | 429 surge or free-tier abuse IPs | P3 | Discord (security) |
| A16 | Auth failure spike | Loki | auth-fail rate spike | P2 | Discord (security) |
| A17 | Revenue anomaly | Prom | `billing_usdt_total` flatline during traffic | P2 | Discord (revenue) |
| A18 | Cardinality / cost guard | Mimir/Loki | active series or log GB over budget | P3 | Discord (platform) |

Alerting engine: **Grafana Unified Alerting** (rules provisioned as code), routed
via Alertmanager to Discord (exists), email, and PagerDuty/Opsgenie for P1 +
enterprise. Per-persona alerts (A13/A14) delivered to operator/enterprise
webhooks, never cross-tenant.

---

## 11. Rollout phases (for the LATER implementation sprint)

0. **(this doc)** Approve blueprint, topology, cardinality budget, SLO targets.
1. **Foundation:** stand up Grafana Cloud + Alloy on Railway; scrape existing
   `/rpc/metrics/prometheus` + prom-client; ship pino logs to Loki. Admin-only.
2. **Tenant labels:** add `tier/api_key_hash/node_id/region` labels + recording
   rules; build D1/D8/D9/D14/D15.
3. **Tracing:** add OpenTelemetry SDK → Tempo; wire exemplars + trace/log links;
   D12/D13.
4. **Embed layer:** `/api/grafana/*` BFF + `<GrafanaPanel/>`; Developer (D2/D3)
   and Node Operator (D4) embeds in Satelink OS.
5. **Distributor/Enterprise:** D6/D7, SLA error budgets, enterprise alert routes.
6. **Alerts & on-call:** provision A1–A18, PagerDuty integration, runbooks.
7. **Decommission** `signoz/`.

---

## 12. Open decisions for review

1. **Grafana Cloud vs self-host** — recommend Cloud first (ops cost). Approve?
2. **Per-tenant isolation** — embed-proxy forced-label-filter + scoped tokens
   (recommended) vs Grafana org-per-tenant (heavier). Approve approach?
3. **SLO targets** — confirm numeric SLOs per persona (gateway success %, p95 ms,
   node uptime %, enterprise availability %).
4. **Trace sampling** — 100% error/slow + 5–10% tail. Acceptable cost?
5. **Cardinality budget** — top-N developers/nodes get live per-tenant series;
   long tail via on-demand Loki/SQL. Confirm N and retention windows.
6. **Alert sinks** — confirm PagerDuty/Opsgenie for P1 + enterprise on-call.
```
