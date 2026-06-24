# 05 — Risk Analysis

> Likelihood × Impact, with the mitigation already designed into this package.

## R1 — Metric cardinality explosion (HIGH impact)
- **Risk:** labelling series by raw `api_key`/`wallet`/`tx_hash` makes Prometheus
  series unbounded → OOM, slow queries, runaway cost.
- **Mitigation:** §4 cardinality guardrail — only low-cardinality labels become
  series; per-tenant data via **recording rules with top-N** (`topk(100, ...)`).
  Alloy `prometheus.relabel` has a defensive `labeldrop` for `api_key|wallet|raw_.*`.
  Loki `max_streams_per_user` + `max_label_names_per_series` cap log cardinality.
- **Residual:** medium-tail developers fall back to on-demand Loki/SQL, not live series.

## R2 — Tenant data leakage across personas (CRITICAL impact)
- **Risk:** a developer sees another tenant's metrics/logs/traces through an
  embedded panel.
- **Mitigation:** defense-in-depth — (1) embed proxy is the **only** public door;
  (2) per-request **scoped** Grafana service-account token; (3) **forced label
  filter** injected server-side; (4) Grafana cookies stripped so the browser holds
  no Grafana credentials; (5) folder/team RBAC per persona. Admin bypass is explicit.
- **Test gate:** Phase 6 isolation test (developer A ≠ developer B) must pass before GA.

## R3 — OTel auto-instrumentation overhead / breakage (MEDIUM)
- **Risk:** tracing adds latency or a bad instrumentation crashes `apps/api` (the
  load-bearing revenue path).
- **Mitigation:** SDK is **hard-off** unless `OTEL_EXPORTER_OTLP_ENDPOINT` set;
  `fs` instrumentation disabled; sampling pushed to collector (SDK overhead is span
  creation only). Roll out behind the env flag; revert PR is clean. Curl regression
  on `/health`, `/api/status`, `/credits/deposit/initiate` in Phase 4.

## R4 — Self-hosting ops burden vs Grafana Cloud (MEDIUM)
- **Risk:** the OSS LGTM stack is more to operate (upgrades, disk, S3, backups)
  than the Cloud path the original blueprint preferred.
- **Mitigation:** single-binary Loki/Tempo + object-storage offload keeps the box
  stateless-ish; compose pins image versions; retention bounds disk. **Escape
  hatch:** the same dashboards/alerts/datasource provisioning port to Grafana Cloud
  unchanged if ops cost proves too high — Cloud remains the documented alternative.

## R5 — Exposure of LGTM backends (HIGH)
- **Risk:** Prometheus/Loki/Tempo have no real auth (`auth_enabled: false`); if
  exposed they leak everything.
- **Mitigation:** bound to private docker network + tailnet; firewall inbound to
  tailnet only; Grafana bound to `127.0.0.1` and reached solely via the BFF. No
  public hostnames for backends.

## R6 — Secret sprawl (MEDIUM)
- **Risk:** S3 keys, DB DSN, Grafana SA token, Discord/PagerDuty keys across
  Hetzner `.env`, Railway, Vercel.
- **Mitigation:** least-privilege (read-only PG role, scoped S3 keys, short-lived
  Grafana tokens); secrets via platform env stores, never committed; the committed
  artifacts use `${VAR}` placeholders only. Per CLAUDE.md: `process.env`, hard-fail
  if missing.

## R7 — Log drain / collector single point of failure (MEDIUM)
- **Risk:** if Alloy is down, metrics/logs/traces stop (observability gap, not a
  prod outage).
- **Mitigation:** Alloy `restart: unless-stopped`; can run a second instance on
  Hetzner as backup scraper; Prometheus retains last-scrape; alert **A5/own
  meta-monitoring** on `up{job="alloy"} == 0`. Observability loss never blocks the
  revenue path (fully decoupled).

## R8 — Cost overrun (MEDIUM)
- **Risk:** trace/log volume grows → object-storage + egress cost climbs.
- **Mitigation:** retention caps (Prom 15d, Loki 30d, Tempo 14d); tail sampling;
  cardinality budget alert **A18**; flat Hetzner box cost is predictable; object
  storage is the only variable and is bounded by retention.

## R9 — CSP / iframe embedding regressions (LOW)
- **Risk:** same-origin embed under `/api/grafana` breaks cookies/CSP or Grafana
  sub-path serving misbehaves.
- **Mitigation:** `GF_SERVER_SERVE_FROM_SUB_PATH=true` + same-origin `frame-src
  'self'`; panels feature-flagged; Admin-first rollout catches it before tenant
  exposure.

## R10 — Scope creep into Design System v2 (LOW, but called out)
- **Risk:** embedding pressure to restyle dashboards changes v2.
- **Mitigation:** explicit constraint — Grafana renders **inside**
  `DashboardSection` via `<GrafanaPanel/>`; non-admin KPI strip uses **API-fed
  native StatCards** (v2 primitives), iframes only for charts. v2 is not modified.

## Risk matrix

| Risk | Likelihood | Impact | Priority |
|---|---|---|---|
| R2 tenant leakage | Low | Critical | **P1 gate** |
| R1 cardinality | Medium | High | **P1** |
| R5 backend exposure | Low | High | **P1** |
| R3 OTel breakage | Low | Medium | P2 |
| R4 ops burden | Medium | Medium | P2 |
| R7 collector SPOF | Medium | Medium | P2 |
| R8 cost | Medium | Medium | P2 |
| R6 secrets | Low | Medium | P2 |
| R9 CSP/iframe | Low | Low | P3 |
| R10 v2 scope creep | Low | Low | P3 |
