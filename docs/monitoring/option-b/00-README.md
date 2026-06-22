# Embedded Grafana (Option B) — Self-Hosted LGTM Implementation Package

> **STATUS: ARCHITECTURE REVIEW — DO NOT IMPLEMENT UNTIL APPROVED.**
> No code in `apps/` or `apps/web/` has been modified. Everything here is a
> design artifact (docs + proposed config/compose files) for review.

This package is the **concrete, self-hosted Grafana OSS** implementation of the
monitoring strategy. It complements the higher-level
[`../grafana-monitoring-blueprint.md`](../grafana-monitoring-blueprint.md),
which leaned toward managed **Grafana Cloud**. The objective for this round is
explicitly the **OSS LGTM stack** (Grafana OSS + Prometheus + Loki + Tempo +
Alloy) deployable via docker-compose on **Hetzner**, with **Railway** running
only the collector sidecar.

## What changed vs the original blueprint

| Decision | Original blueprint | This package |
|---|---|---|
| Backend | Grafana Cloud (managed Mimir/Loki/Tempo) | **Self-hosted Grafana OSS + Prometheus + Loki + Tempo** |
| Compose | none | **`docker-compose.yml` + all collector configs** (artifacts) |
| Host | Railway only | **Hetzner (LGTM stack) + Railway (Alloy sidecar)** |
| Integration targets | generic API | **6 named engines wired explicitly** (see 03) |

## Document index

| File | Deliverable |
|---|---|
| [`01-topology.md`](01-topology.md) | Deployment topology (self-hosted) |
| [`docker-compose.yml`](docker-compose.yml) | The LGTM stack (artifact, not deployed) |
| [`config/`](config/) | prometheus / loki / tempo / alloy / grafana provisioning (artifacts) |
| [`02-deployment-railway-hetzner.md`](02-deployment-railway-hetzner.md) | Railway + Hetzner deployment plan |
| [`03-code-changes.md`](03-code-changes.md) | Required code changes: Prom metrics, Loki shipping, OTel tracing, embed proxy |
| [`04-deployment-checklist.md`](04-deployment-checklist.md) | Step-by-step deployment checklist |
| [`05-risk-analysis.md`](05-risk-analysis.md) | Risk analysis + mitigations |
| [`06-dashboard-inventory.md`](06-dashboard-inventory.md) | Developer / Node Operator / Distributor / Enterprise / Admin dashboards |

## Six integration targets → real code (verified 2026-06-21)

| Engine | Source of truth in repo | Signal it emits |
|---|---|---|
| **API Gateway** | `apps/api/src/gateway/`, `apps/api/src/workloads/rpc_gateway/` | RED metrics, traces (root span), access logs |
| **Revenue Engine** | `apps/api/src/economics/` (epoch_aggregator, pricing_engine, revenue_oracle) | billing counters, USDT totals, margin guards |
| **Settlement Engine** | `apps/api/src/settlement/settlement_engine.js`, `apps/api/src/services/settlement/merkle_anchor.js` | anchor lag, signer balance, settlement tx status |
| **Node Registry** | `apps/api/src/nodes/node_registry.js`, `apps/api/src/services/node_registry/` | node up/heartbeat, jobs served, reputation, earnings |
| **Demand Radar** | `apps/api/src/scheduler/demand_flywheel_engine.js`, `market_scanner.js`, `workload_acquisition_engine.js` | demand scanned, jobs matched/ingested, fill rate |
| **Treasury** | `apps/api/src/settlement/simulationTreasury.js`, `apps/api/src/economics/economic_ledger.js` | balances, split distribution, payout queue depth |

## Existing instrumentation (reuse — do not rebuild)

- `prom-client@15` already mounted: **`GET /metrics`** at `apps/api/src/gateway/routes.js:128`
  (default-register text format).
- **`GET /rpc/metrics/prometheus`** at `apps/api/src/workloads/rpc_gateway/metrics.js`
  (RPC snapshot in Prometheus text format).
- `pino@10` JSON → stdout at `apps/api/src/monitoring/logger.js`.
- **Gaps to close (designed in 03):** no shared prom-client registry across engines,
  no OTel SDK, no Loki shipper, no tenant labels, no Grafana, no embed proxy.

## Approval gate

Implementation begins **only** after sign-off on the
[Open decisions](#open-decisions) below and §12 of the parent blueprint.

### Open decisions

1. **Host split** — Hetzner CX/CPX dedicated for LGTM + Railway Alloy sidecar (recommended), vs all-Railway, vs Grafana Cloud. Approve?
2. **Object storage** — Hetzner Object Storage (S3-compatible) vs Cloudflare R2 for Loki/Tempo chunks. Approve?
3. **Retention** — Prom 15d local, Loki 30d, Tempo 14d. Approve numbers (cost driver)?
4. **Tenant isolation** — embed-proxy forced-label-filter + per-persona service-account tokens (recommended) vs org-per-tenant. Approve?
5. **Exposure** — LGTM stack private (Tailscale/WireGuard) with only Grafana behind the embed proxy. Approve?
