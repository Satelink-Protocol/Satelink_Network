# 04 — Deployment Checklist

> Execute **only after architecture review sign-off.** Each phase is independently
> revertible. Phases 1–3 touch **no Satelink code** (pure infra + drains).

## Phase 0 — Approval gate
- [ ] §12 blueprint open decisions answered
- [ ] `00-README.md` open decisions 1–5 answered (host split, object storage, retention, isolation, exposure)
- [ ] SLO targets confirmed per persona (gateway success %, p95 ms, node uptime %, enterprise availability %)
- [ ] Cardinality + retention budget signed off (cost owner)

## Phase 1 — Hetzner LGTM stack (no code)
- [ ] Provision CPX41, Ubuntu 24.04, harden (SSH keys, ufw deny, fail2ban)
- [ ] Install Docker + compose plugin
- [ ] Join tailnet (Tailscale/WireGuard); firewall inbound to tailnet only
- [ ] Create object-storage buckets `satelink-loki`, `satelink-tempo` + scoped keys
- [ ] Create read-only Postgres role for `postgres_exporter`
- [ ] Populate `.env` from template (02 §A); verify no secret committed
- [ ] `docker compose up -d`
- [ ] Health: `grafana/api/health`, `prometheus/-/healthy`, `loki/ready`, `tempo/ready`, `alertmanager/-/healthy`
- [ ] Confirm Prometheus is scraping `rpc.satelink.network/metrics` + `/rpc/metrics/prometheus`
- [ ] Confirm exporters (postgres, redis) show `up == 1`

## Phase 2 — Alloy collector (no code)
- [ ] Create Railway `alloy-collector` service in project `0312ce4a-...`
- [ ] Mount `config/alloy/config.alloy`; set remote_write/push/OTLP env to Hetzner tailnet
- [ ] Join Railway service to tailnet; confirm private reachability to Hetzner
- [ ] Verify Alloy `/-/ready` and that metrics land in Prometheus

## Phase 3 — Logs (no code)
- [ ] Configure Railway HTTP log drain → Alloy `loki.source.api` (:3500)
- [ ] Confirm pino JSON lands in Loki; labels are low-cardinality `{service,level,route_class}`
- [ ] Build D12 Logs Explorer; verify field extraction (`request_id`, `api_key_hash`)

## Phase 4 — API instrumentation (code; merge to main)
- [ ] PR: shared registry (`metrics_registry.mjs`) + switch `/metrics` to it
- [ ] PR: per-engine metrics for the 6 engines (Gateway, Revenue, Settlement, Node Registry, Demand Radar, Treasury)
- [ ] PR: `labels.mjs` (`api_key_hash`, `route_class`); confirm NO raw key/wallet labels
- [ ] PR: OTel `tracing.mjs` imported first in `server.js`; deps added
- [ ] PR: pino `mixin` adds `trace_id`/`span_id`
- [ ] Set `apps/api` env: `OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy-collector:4318`
- [ ] **Merge to main** (per CLAUDE.md, `railway up` does NOT ship app code)
- [ ] Verify: traces appear in Tempo; service graph renders; exemplars link metric→trace
- [ ] Curl regression: `/health`, `/api/status`, `/credits/deposit/initiate?amount=1` still 200

## Phase 5 — Recording rules, dashboards, alerts (as code)
- [ ] Load recording + alerting rules; confirm `rpc:request_error_ratio:5m` evaluates
- [ ] Provision per-persona folders + dashboards (D1–D16) into Grafana
- [ ] Provision datasources with exemplar/derived-field correlation
- [ ] Wire Alertmanager: Discord (existing), email, PagerDuty for P1
- [ ] Fire a synthetic alert end-to-end (e.g. force `UpstreamProviderDown`)

## Phase 6 — Embed proxy + Satelink OS (code; Vercel)
- [ ] PR: `/api/grafana/[...path]/route.ts` BFF (auth → scoped token → signed iframe → strip cookies → audit)
- [ ] PR: `<GrafanaPanel/>` in `packages/ui` (inside DashboardSection; v2 untouched)
- [ ] Set `apps/web` env: `GRAFANA_INTERNAL_URL`, `GRAFANA_SA_TOKEN`, `GRAFANA_SIGNING_SECRET`
- [ ] Admin Command Center embeds full org first; verify
- [ ] Developer (/usage,/overview) + Node Operator (/nodes) tenant-scoped embeds
- [ ] **Tenant isolation test:** developer A cannot see developer B's series (token scope + forced filter)

## Phase 7 — Personas + decommission
- [ ] Distributor (D6) + Enterprise (D7) dashboards + SLA error-budget alerts
- [ ] Per-tenant operator/enterprise alert webhooks (no cross-tenant)
- [ ] Runbooks for A1–A18
- [ ] Remove `signoz/`; update CLAUDE.md monitoring section + memory note

## Rollback per phase
- Phases 1–3: `docker compose down` / disable log drain — zero impact on prod app.
- Phase 4: revert PR; OTel is hard-off when `OTEL_EXPORTER_OTLP_ENDPOINT` unset.
- Phase 6: feature-flag the embed panels; BFF route can 503 without breaking pages.
