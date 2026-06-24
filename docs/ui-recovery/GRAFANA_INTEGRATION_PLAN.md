# GRAFANA_INTEGRATION_PLAN.md

Requirement: Grafana appears **inside** Satelink OS as a native experience, not a separate
product. This plan covers the embedding + auth bridge layer; the data-plane (LGTM stack) is
already designed in `docs/monitoring/`.

---

## 1. Current monitoring architecture (verified)

| Layer | State | Evidence |
|---|---|---|
| Metrics client | EXISTS | `prom-client` in `apps/api`; custom network metrics in `apps/api/src/workloads/rpc_gateway/metrics.js` |
| Metrics endpoints | EXISTS | `GET /rpc/metrics` (JSON, `metrics.js:155`), `GET /rpc/metrics/prometheus` (text, `metrics.js:197`) |
| Frontend proxy | EXISTS | `apps/web/next.config.ts` rewrites `/metrics`, `/metrics/json` → API |
| Structured logs | EXISTS | `pino` JSON → stdout (Railway captures) |
| LGTM stack design | DESIGN-ONLY | `docs/monitoring/grafana-monitoring-blueprint.md` + `docs/monitoring/option-b/` (docker-compose, Prometheus/Loki/Tempo/Alloy/Grafana provisioning) |
| **Grafana deployed** | **NO** | No Grafana service in any compose/railway config; no embed route in `apps/web` |
| **Embedded in OS** | **NO** | No `/satelink/os/monitoring` route; SigNoz trial in `signoz/` is being dropped |

**Missing pieces (gaps to close):**
1. Distributed tracing — no OpenTelemetry SDK → Tempo has no source.
2. Log shipper — pino→stdout exists, nothing forwards to Loki.
3. Tenant label model — metrics not labelled by `api_key`/`node_id`/`tier`.
4. **Grafana itself + auth bridge + in-OS embed route** ← this document.

---

## 2. Deployment architecture (reuse the approved Option B)

```
apps/api (Railway)  ──/rpc/metrics/prometheus──┐
node-agents         ──/metrics─────────────────┤
pino stdout / OTel  ───────────────────────────┤
                                               ▼
                          Grafana Alloy (collector)
                                               │
                 ┌──────────────┬──────────────┴──────────────┐
                 ▼              ▼                              ▼
            Prometheus       Loki                           Tempo        (Hetzner docker-compose
              (metrics)     (logs)                         (traces)       OR Grafana Cloud managed)
                 └──────────────┴──────────────┬──────────────┘
                                               ▼
                                        Grafana OSS
                              (provisioned datasources + dashboards,
                               per-persona orgs/folders, service accounts)
```

Provisioning files already exist under `docs/monitoring/option-b/config/grafana/` (datasources
with metric→trace→log correlation). **Promote them to deployed infra; do not rewrite.**

---

## 3. Embedding architecture — Grafana INSIDE Satelink OS

The product requirement is "not a separate user experience." Use **panel/dashboard iframe
embedding behind a Next.js BFF**, so the user never sees a Grafana login or leaves the OS shell.

### 3.1 New route (in-shell)
```
apps/web/src/app/satelink/os/monitoring/page.tsx        # operator-facing dashboards
apps/web/src/app/admin/command-center  (Alert Center)   # admin embeds (see COMMAND_CENTER_V3)
```
- `monitoring/page.tsx` renders inside the existing `os/layout.tsx` `DashboardShell` (add a
  `Monitoring` nav item to `NAV` in `layout.tsx`). It hosts `<GrafanaPanel>` iframes — chrome
  stays Satelink, content is Grafana.

### 3.2 BFF embed proxy (auth bridge)
```
apps/web/src/app/api/grafana/[...path]/route.ts   # NEW — server-side proxy
```
Responsibilities:
1. Authenticate the Satelink session (existing OS auth).
2. Map Satelink identity → Grafana org/team/scope (tier/persona).
3. Mint a **signed embed token / service-account-scoped URL** server-side (Grafana API key
   never reaches the browser).
4. Proxy the iframe/panel request to Grafana with that token.

This mirrors the `/api/admin-proxy` pattern already used by `command-center` — same shape,
different upstream.

### 3.3 Panel component (in `@satelink/ui`)
```
packages/ui/src/components/viz/grafana-panel.tsx   # NEW, exported from index.ts
```
- Props: `dashboardUid`, `panelId?`, `from`/`to`, `vars`. Renders an `<iframe>` to
  `/api/grafana/render/...` (the BFF), wrapped in `DashboardSection` + `AsyncBoundary` so it
  inherits OS loading/error states. Theme-synced (`&theme=dark`) to match Satelink tokens.

---

## 4. Authentication approach

| Concern | Approach |
|---|---|
| User never logs into Grafana | All requests go through `/api/grafana/*` BFF; browser holds only the Satelink session cookie. |
| Grafana credential safety | Service-account API token lives in server env (`GRAFANA_SA_TOKEN`), used only server-side. |
| Per-persona scoping | BFF maps Satelink role → Grafana org/folder (operator vs admin) and injects dashboard var filters (`tier`, `node_id`, `api_key_hash`). |
| Anonymous embed disabled | Grafana `allow_embedding=true` + `auth.proxy` or signed URLs; no anonymous org. |
| Tenant isolation | Operators see only their `node_id`/`api_key` data via templated dashboard variables enforced server-side. |

---

## 5. Dashboard mapping (Satelink view → Grafana dashboard)

| Satelink OS surface | Grafana dashboard (uid) | Primary datasource |
|---|---|---|
| `os/overview` KPI strip | `satelink-exec-overview` | Prometheus (recording rules) |
| `os/monitoring` (NEW) | `satelink-rpc-throughput`, `satelink-latency`, `satelink-errors` | Prometheus + Tempo exemplars |
| `os/nodes` | `satelink-node-fleet` (per `node_id` var) | Prometheus + Loki |
| `os/usage` | `satelink-tenant-usage` (per `api_key` var) | Prometheus |
| command-center NOC | `satelink-network-health` | Prometheus + Tempo |
| command-center Settlement | `satelink-settlement-epochs` | Postgres/`revenue_events_v2` via Prometheus exporter |
| command-center Alert Center | Grafana Unified Alerting feed | Alertmanager |

---

## 6. Implementation order
1. Stand up LGTM + Grafana from `docs/monitoring/option-b/` (infra; already designed).
2. Close gaps 1–3 (OTel SDK, Alloy log drain, tenant labels) — backend.
3. Build the BFF `app/api/grafana/[...path]/route.ts` + `GrafanaPanel` in `@satelink/ui`.
4. Add `os/monitoring/page.tsx` + nav item; embed the throughput/latency/error dashboards.
5. Wire command-center NOC/Settlement/Alert tiles to embedded panels (`COMMAND_CENTER_V3`).

Until step 1 is approved/funded, the monitoring docs remain design-only (per memory:
`monitoring-grafana-option-b`).
