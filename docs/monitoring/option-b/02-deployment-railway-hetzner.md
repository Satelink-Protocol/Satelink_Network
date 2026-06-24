# 02 — Railway + Hetzner Deployment Plan

> Design artifact. Nothing here is executed until the architecture review is approved.

## Split of responsibilities

| Concern | Host | Why |
|---|---|---|
| Stateful LGTM (Grafana, Prometheus, Loki, Tempo, Alertmanager, exporters) | **Hetzner** (docker-compose) | Flat cost, NVMe for TSDB, full retention control, no per-series metering |
| Collector (Alloy) | **Railway sidecar** (primary) + Hetzner (secondary) | Low-latency scrape/OTLP next to `apps/api`; keeps Railway log drains internal before egress |
| Embed proxy `/api/grafana/*` | **Vercel** (existing `apps/web`) | Only public ingress to Grafana; co-located with dashboards |
| Object storage (Loki/Tempo chunks) | **Hetzner Object Storage** or **Cloudflare R2** | Bounds Hetzner disk; cheap cold tier |

## A. Hetzner provisioning

1. Provision **1× CPX41** (8 vCPU / 16 GB / 240 GB NVMe), Ubuntu 24.04 LTS.
2. Harden: SSH keys only, `ufw` default-deny, fail2ban.
3. Install Docker Engine + compose plugin.
4. **Private networking:** join a **Tailscale/WireGuard tailnet**. Firewall inbound
   to tailnet only — no public ports except what the embed proxy reaches (Grafana
   is bound to `127.0.0.1:3000` and tunneled, not published).
5. Create object-storage buckets: `satelink-loki`, `satelink-tempo`; mint scoped
   S3 access keys.
6. Drop this `option-b/` directory onto the box (or a release tarball of just the
   compose + config), create `.env` from the template below.
7. `docker compose up -d` → verify each service health endpoint.

### `.env` template (Hetzner box — never commit real values)

```dotenv
# Grafana
GRAFANA_ROOT_URL=https://app.satelink.network/api/grafana
GF_ADMIN_USER=admin
GF_ADMIN_PASSWORD=__strong_random__
# Object storage (S3-compatible)
S3_ENDPOINT=https://<region>.your-objectstorage.com
S3_BUCKET_LOKI=satelink-loki
S3_BUCKET_TEMPO=satelink-tempo
S3_ACCESS_KEY=__key__
S3_SECRET_KEY=__secret__
# Scrape / exporters
API_SCRAPE_TARGET=rpc.satelink.network
API_METRICS_TOKEN=__optional_bearer__
POSTGRES_EXPORTER_DSN=postgres://readonly:__pw__@<pg-host>:5432/satelink?sslmode=require
REDIS_EXPORTER_ADDR=redis://<redis-host>:6379
REDIS_EXPORTER_PASSWORD=__pw__
# Alerts
DISCORD_WEBHOOK_URL=__existing_discord_webhook__
PAGERDUTY_ROUTING_KEY=__pd_key__
```

> Use a **read-only** Postgres role for `postgres_exporter`. Get the DB host from
> Railway's `DATABASE_PUBLIC_URL` (Postgres-iQeW), or attach the exporter to the
> Railway private network instead of exposing Postgres publicly (preferred).

## B. Railway — Alloy sidecar service

1. New Railway service `alloy-collector` in the existing project
   (`0312ce4a-fb7b-41be-b7c7-0d3dcfdc0f89`), image `grafana/alloy:v1.5.1`.
2. Mount `config/alloy/config.alloy` (via repo build context or a config volume).
3. Env vars point remote_write/push/OTLP at the **Hetzner tailnet addresses**:
   `PROM_REMOTE_WRITE_URL`, `LOKI_PUSH_URL`, `TEMPO_OTLP_ENDPOINT`, `API_SCRAPE_TARGET`.
4. Join the same tailnet as Hetzner so egress is private + authenticated.
5. **Railway log drain:** configure the project's log drain (HTTP) to POST to
   Alloy `loki.source.api` (`:3500`) so `apps/api` stdout → Loki without code changes.

## C. apps/api — OTLP export target

- `apps/api` (Railway) sends OTLP traces to the **Alloy sidecar** on the Railway
  private network (`http://alloy-collector:4318`) — set `OTEL_EXPORTER_OTLP_ENDPOINT`.
- Metrics require no push: Alloy scrapes the existing `/metrics` over HTTPS.
- **No public deploy of LGTM** — only `apps/api` env vars change, behind the
  approval gate (see [03](03-code-changes.md)).

## D. apps/web — embed proxy

- The `/api/grafana/*` route handler (see [03](03-code-changes.md) §4) reaches
  Grafana over the tailnet (`GRAFANA_INTERNAL_URL`), mints scoped service-account
  tokens, returns signed kiosk iframe URLs. Deployed with the normal Vercel flow.

## DNS / origin

- Grafana is **not** given a public hostname. It is served under
  `https://app.satelink.network/api/grafana` via the BFF (`GF_SERVER_SERVE_FROM_SUB_PATH=true`).
- This keeps a single origin (good for CSP `frame-src 'self'` and cookie handling).

## Deploy order (once approved)

1. Hetzner LGTM up + healthy (no Satelink code touched yet).
2. Railway Alloy sidecar up; confirm it reaches Hetzner over tailnet.
3. Configure Railway log drain → Alloy (logs start flowing, still code-free).
4. Merge `apps/api` instrumentation PR (shared registry + OTel) → metrics/traces flow.
5. Merge `apps/web` embed-proxy PR → panels render in Satelink OS (Admin first).
6. Provision dashboards + alerts as code; enable Unified Alerting routes.
7. Decommission `signoz/`.

> Per CLAUDE.md: `railway up` does **not** ship local code; the `apps/api` change
> reaches production via **merge to main**. The Alloy sidecar is a separate Railway
> service and is deployed independently.
