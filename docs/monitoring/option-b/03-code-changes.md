# 03 — Required Code Changes (SPEC — not applied)

> Every change below is **specified, not implemented.** No file under `apps/` has
> been modified. These are the diffs to write **after** the architecture review is
> approved. File paths are verified against the repo as of 2026-06-21.

## Summary of changes by area

| # | Area | Files (new / modified) | Effort |
|---|---|---|---|
| 1 | Shared Prometheus registry + helpers | NEW `apps/api/src/monitoring/metrics_registry.mjs` | S |
| 2 | Per-engine metric instrumentation | modify the 6 engines (below) | M |
| 3 | Tenant labels (low-cardinality) + `api_key_hash` helper | NEW `apps/api/src/monitoring/labels.mjs` | S |
| 4 | OpenTelemetry tracing bootstrap | NEW `apps/api/src/monitoring/tracing.mjs`; modify `server.js` | M |
| 5 | trace_id in pino logs | modify `apps/api/src/monitoring/logger.js` | S |
| 6 | Loki shipping | **no code** — Railway log drain → Alloy | — |
| 7 | Node-agent Prometheus SD endpoint | NEW route under `apps/api/src/nodes/` | S |
| 8 | Web Vitals beacon → metric | modify `apps/web` instrumentation | S |
| 9 | Embed proxy BFF | NEW `apps/web/src/app/api/grafana/[...path]/route.ts` | M |
| 10 | `<GrafanaPanel/>` UI primitive | NEW `packages/ui/src/components/grafana-panel.tsx` | S |

---

## 1. Shared Prometheus registry

Today only `apps/api/src/gateway/routes.js:128` exposes `client.register` (the
default registry). Each engine should register on **one shared registry** so a
single `/metrics` scrape covers all six engines.

```js
// NEW apps/api/src/monitoring/metrics_registry.mjs  (SPEC)
import client from 'prom-client';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: 'satelink_' });

// Factory helpers so engines don't each new-up duplicate metrics.
export const counter = (cfg) => new client.Counter({ ...cfg, registers: [registry] });
export const gauge   = (cfg) => new client.Gauge({ ...cfg, registers: [registry] });
export const histogram = (cfg) => new client.Histogram({ ...cfg, registers: [registry] });
```

`gateway/routes.js` `/metrics` handler switches from `client.register` to this
shared `registry`. `rpc_gateway/metrics.js` `/rpc/metrics/prometheus` stays as-is
(snapshot endpoint) — Alloy scrapes both.

## 2. Per-engine instrumentation (the six targets)

Each engine imports `counter/gauge/histogram` from the shared registry. **No raw
`api_key`/`wallet` as labels** — use `api_key_hash` only for top-N gauges.

| Engine | File to instrument | Metrics to emit |
|---|---|---|
| **API Gateway** | `apps/api/src/workloads/rpc_gateway/` request path + `gateway/routes.js` | `rpc_requests_total{chain,method,status,tier,route_class}`, `rpc_request_duration_seconds` (histogram, exemplars), `rpc_errors_total{error_code}` |
| **Revenue Engine** | `apps/api/src/economics/epoch_aggregator.js`, `pricing_engine.js`, `revenue_oracle.js` | `billing_events_total{tier,source_type}`, `billing_usdt_total{tier,chain}`, `epoch_active_id`, `jobs_rejected_profit_guard_total` (exists in profitProtection) |
| **Settlement Engine** | `apps/api/src/settlement/settlement_engine.js`, `apps/api/src/services/settlement/merkle_anchor.js` | `settlement_last_anchor_timestamp_seconds`, `settlements_total{status}`, `settlement_signer_balance_pol`, `settlement_dry_run` |
| **Node Registry** | `apps/api/src/nodes/node_registry.js`, `heartbeat.js`, `apps/api/src/services/node_registry/earnings_aggregator.js`, `offline_detector.js` | `active_nodes{region,tier}` (exists), `node_up{node_id,region}`, `node_heartbeat_age_seconds{node_id}`, `node_jobs_served_total{node_id,status}`, `node_reward_usdt_total{node_id}` |
| **Demand Radar** | `apps/api/src/scheduler/demand_flywheel_engine.js`, `market_scanner.js`, `workload_acquisition_engine.js`, `job_matching_engine.js` | `demand_scanned_total{source}`, `jobs_matched_total{source,outcome}`, `demand_fill_ratio` (gauge), `connector_jobs_ingested_total` (exists) |
| **Treasury** | `apps/api/src/settlement/simulationTreasury.js`, `apps/api/src/economics/economic_ledger.js` | `treasury_balance_usdt{account}`, `treasury_split_distributed_total{recipient_class}`, `payout_queue_depth` |

> Where a value already lives in Redis/Postgres (e.g. `rpc:requests:*`,
> `revenue_events_v2`, `epoch_ledger`), emit it as a gauge populated by a periodic
> **collector tick** rather than instrumenting the hot path — cheaper and avoids
> double counting. The existing `rpc_gateway/metrics.js` already demonstrates the
> Redis/PG read pattern to reuse.

## 3. Tenant label helper

```js
// NEW apps/api/src/monitoring/labels.mjs  (SPEC)
import { createHash } from 'node:crypto';
// Never expose the raw key as a label/series. Hash for top-N gauges only.
export const apiKeyHash = (key) =>
  key ? createHash('sha256').update(key).digest('hex').slice(0, 16) : 'anon';
export const routeClass = (path) =>
  path.startsWith('/rpc') ? 'rpc'
  : path.startsWith('/v1') ? 'ai'
  : path.startsWith('/credits') ? 'billing'
  : path.startsWith('/api/nodes') ? 'nodes' : 'other';
```

## 4. OpenTelemetry tracing (the main NEW instrumentation)

```js
// NEW apps/api/src/monitoring/tracing.mjs  (SPEC) — imported FIRST in server.js
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { Resource } from '@opentelemetry/resources';

export function startTracing() {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return; // hard-off if unset
  const sdk = new NodeSDK({
    resource: new Resource({ 'service.name': 'satelink-api', 'service.namespace': 'satelink' }),
    traceExporter: new OTLPTraceExporter(), // reads OTEL_EXPORTER_OTLP_ENDPOINT
    instrumentations: [getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false },
    })],
  });
  sdk.start();
}
```

`server.js` change: `import { startTracing } from './src/monitoring/tracing.mjs'; startTracing();`
**before** any express/pg/ioredis import so auto-instrumentation patches them. This
gives spans for Express routes, `pg`, `ioredis`, and outbound `http` (Polygon
upstream calls) automatically. Add manual spans only at `billing.deduct` and
`settlement.anchor` for the revenue-critical path.

New deps (apps/api): `@opentelemetry/sdk-node`,
`@opentelemetry/auto-instrumentations-node`, `@opentelemetry/exporter-trace-otlp-proto`.

Sampling is done at the collector (Alloy tail sampling) — the SDK exports 100%,
Alloy keeps errors + slow + 10% tail.

## 5. trace_id in logs (Loki ↔ Tempo correlation)

`apps/api/src/monitoring/logger.js` — add a `mixin` that injects the active span's
`trace_id`/`span_id` into every pino line:

```js
import { trace } from '@opentelemetry/api';
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  mixin() {
    const span = trace.getActiveSpan();
    if (!span) return {};
    const { traceId, spanId } = span.spanContext();
    return { trace_id: traceId, span_id: spanId };
  },
  // ...existing transport
});
```

This is the only change needed for trace↔log correlation; Alloy's `loki.process`
already extracts `trace_id` as a field and the Loki datasource derived-field links
it to Tempo.

## 6. Loki shipping — NO CODE

pino already writes JSON to stdout. Railway's **log drain** (configured in 02) POSTs
stdout to Alloy `loki.source.api`. Node-agents push their own logs. Nothing in
`apps/api` changes for logs.

## 7. Node-agent Prometheus service discovery

`config/prometheus/prometheus.yml` references
`GET /api/nodes/prometheus-sd`. Add a small read-only route that returns the
http_sd JSON shape from `node_registry` (online nodes + their `/metrics` address).
Guard it (admin/internal token) so the node inventory isn't public.

## 8. Web Vitals → metric (apps/web)

Use Next.js `useReportWebVitals` (or existing instrumentation) to beacon
LCP/INP/CLS to an API route that increments
`web_vital_*` histograms on the shared registry. Feeds D16.

## 9. Embed proxy BFF (the security boundary)

```ts
// NEW apps/web/src/app/api/grafana/[...path]/route.ts  (SPEC)
// The ONLY public path to Grafana. Pseudocode of the gate:
//
// 1. Authenticate the Satelink principal:
//      - Satelink session JWT (Satelink OS), or X-API-Key (developer), or X-Admin-Key (admin)
// 2. Resolve persona → { grafanaOrgId, team, folder, allowedDashboards, tenantFilter }
//      tenantFilter e.g. { api_key_hash } for developer, { node_id IN (...) } for operator
// 3. Mint a SHORT-LIVED, SCOPED Grafana service-account token (externalServiceAccounts),
//      or build a signed kiosk iframe URL with the tenant template var pre-bound.
// 4. Proxy the request to GRAFANA_INTERNAL_URL (tailnet); inject the forced label
//      filter; STRIP Set-Cookie so the browser never holds Grafana credentials.
// 5. Rate-limit + audit-log every grant (admin-audit log stream).
//
// Admin org bypasses tenantFilter. Non-admin requests that try to query outside
// their folder/label are rejected (defense-in-depth: token scope + forced filter).
```

Env (apps/web): `GRAFANA_INTERNAL_URL` (tailnet), `GRAFANA_SA_TOKEN` (admin SA used
to mint scoped tokens), `GRAFANA_SIGNING_SECRET`.

CSP: `frame-src 'self'` (Grafana served same-origin under `/api/grafana`). No
`embed.allow_embedding` to the open web.

## 10. `<GrafanaPanel/>` primitive

```tsx
// NEW packages/ui/src/components/grafana-panel.tsx  (SPEC)
// Wraps an <iframe> pointing at /api/grafana/d-solo/<uid>/<slug>?panelId=N&kiosk&theme=dark
// + tenant vars. Sandbox: allow-scripts allow-same-origin only. Sizes inside a
// DashboardSection so Design System v2 chrome is preserved (Grafana never the top UX).
```

> **Design System v2 is untouched** — Grafana renders *inside* the existing
> `DashboardShell`/`DashboardSection` via `<GrafanaPanel/>`. No redesign.
