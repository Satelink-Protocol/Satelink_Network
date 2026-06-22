# 01 — Deployment Topology (Self-Hosted LGTM)

> Design artifact. Not deployed.

## 1. Tier diagram

```
┌──────────────────────── EMITTERS (existing Satelink runtime) ───────────────────────┐
│                                                                                       │
│  apps/api  (Railway, Express :8080)                  apps/web (Vercel, Next.js)       │
│  ├─ API Gateway        ─ /metrics (prom)  ─┐         ├─ Web Vitals  ──── beacon ──┐   │
│  ├─ Revenue Engine     ─ shared registry  ─┤         └─ /api/grafana/* embed BFF  │   │
│  ├─ Settlement Engine  ─ shared registry  ─┤                                       │   │
│  ├─ Node Registry      ─ shared registry  ─┤                                       │   │
│  ├─ Demand Radar       ─ shared registry  ─┤   node-agents (operator hosts)        │   │
│  ├─ Treasury           ─ shared registry  ─┤   └─ /metrics + heartbeat ─────────┐  │   │
│  ├─ pino JSON ─────────── stdout ─────────┤                                     │  │   │
│  └─ OTel SDK ──────────── OTLP/gRPC :4317 ─┤  (NEW)                              │  │   │
└───────────────────────────┼───────────────┼─────────────────────────────────────┼──┼───┘
            traces (OTLP)    │   metrics     │ logs (Railway drain / OTLP)          │  │
                            ▼   ▼ scrape     ▼                                      ▼  ▼
┌──────────────────── COLLECTION TIER (Grafana Alloy) ─────────────────────────────────┐
│  Alloy — runs as a Railway sidecar service (close to apps/api) AND/OR on Hetzner:     │
│   • otelcol.receiver.otlp      ← API traces (:4317/:4318)                             │
│   • prometheus.scrape          ← /metrics, /rpc/metrics/prometheus, node-agents,      │
│                                   postgres_exporter, redis_exporter                   │
│   • loki.source (drain/relabel)← Railway log drain (HTTP) + node-agent logs           │
│   • relabel: attach tenant labels {tier, api_key_hash, node_id, region, service}      │
│   • remote_write → Prometheus  · loki.write → Loki  · otelcol.exporter.otlp → Tempo   │
└───────────┬───────────────────────┬──────────────────────────┬───────────────────────┘
            │ remote_write          │ push                      │ OTLP
            ▼                       ▼                           ▼
   ┌──────────────┐        ┌──────────────┐            ┌──────────────┐
   │  Prometheus  │        │     Loki     │            │    Tempo     │   ← HETZNER box
   │  (TSDB 15d)  │        │ (logs 30d)   │            │ (traces 14d) │     (docker-compose)
   │  + recording │        │  chunks → S3 │            │  blocks → S3 │
   │    rules     │        └──────┬───────┘            └──────┬───────┘
   └──────┬───────┘               │  Hetzner Object Storage (S3) / R2 │
          │   exemplars · trace↔log correlation                        │
          └───────────────┬───────────────────────────────────────────┘
                          ▼
                 ┌──────────────────┐
                 │   Grafana OSS    │  ← HETZNER (docker-compose)
                 │  provisioned DS  │     orgs/teams/folders, RBAC, Unified Alerting
                 │  + dashboards    │     service accounts (per persona)
                 └────────┬─────────┘
                          │ private network only (WireGuard/Tailscale)
                          ▼
        ┌──────────────────────────────────────────────┐
        │  apps/web  /api/grafana/*  (Next.js BFF)      │  ← the ONLY public door to Grafana
        │  verify principal → mint scoped SA token →    │
        │  signed kiosk iframe URL with tenant var bound│
        └────────┬─────────────────────────────────────┘
                 ▼
        Satelink OS  <GrafanaPanel/>  + Admin Command Center (full org)

   Alerting: Grafana Unified Alerting → Alertmanager → Discord (exists) / email / PagerDuty
```

## 2. Component placement & sizing (initial)

| Component | Host | Image | Port (internal) | Sizing (start) |
|---|---|---|---|---|
| Grafana OSS | Hetzner | `grafana/grafana-oss:11.x` | 3000 | 1 vCPU / 1 GB |
| Prometheus | Hetzner | `prom/prometheus:v2.x` | 9090 | 2 vCPU / 4 GB + 50 GB SSD |
| Loki | Hetzner | `grafana/loki:3.x` | 3100 | 1 vCPU / 2 GB + S3 |
| Tempo | Hetzner | `grafana/tempo:2.x` | 3200 / 4317 | 1 vCPU / 2 GB + S3 |
| Alloy (collector) | Railway sidecar **and** Hetzner | `grafana/alloy:latest` | 12345 / 4317 / 4318 | 0.5 vCPU / 512 MB |
| postgres_exporter | Hetzner or Railway | `quay.io/prometheuscommunity/postgres-exporter` | 9187 | tiny |
| redis_exporter | Hetzner or Railway | `oliver006/redis_exporter` | 9121 | tiny |
| Alertmanager | Hetzner | `prom/alertmanager:v0.27` | 9093 | tiny |

**Recommended Hetzner machine:** 1× **CPX41** (8 vCPU / 16 GB / 240 GB NVMe) runs
the whole LGTM stack comfortably at current scale; scale to a dedicated CCX line if
trace/log volume grows. Object storage offloads long-term chunks so the box disk
stays bounded.

## 3. Network & trust boundaries

- **Private mesh:** LGTM containers communicate over the docker-compose internal
  network. Prometheus/Loki/Tempo/Alertmanager are **never** exposed publicly.
- **Grafana** is reachable only via the Hetzner private network + the Next.js embed
  proxy (or behind a WireGuard/Tailscale tailnet). No public Grafana login page.
- **Alloy → Hetzner:** Railway-side Alloy ships to Hetzner over an authenticated
  channel (mTLS or tailnet). Inbound to Hetzner is firewalled to the tailnet only.
- **Embed proxy is the single public ingress** to any Grafana surface; it enforces
  Satelink identity, tenant label filter, and strips Grafana cookies.

## 4. Data flow per signal

| Signal | Producer | Transport | Store | UI |
|---|---|---|---|---|
| Metrics | shared prom-client registry on `apps/api`; node-agents; exporters | Alloy `prometheus.scrape` → `remote_write` | Prometheus (+ recording rules) | Grafana / API-fed StatCards |
| Logs | pino JSON → stdout (Railway drain); node-agent logs | Alloy `loki.source` → `loki.write` | Loki (chunks → S3) | Grafana Logs / D12 |
| Traces | OTel SDK on `apps/api` | OTLP → Alloy → Tempo | Tempo (blocks → S3) | Grafana Trace / D13 |
| RUM | Web Vitals beacon (`apps/web`) | beacon → API → registry | Prometheus | D16 |

## 5. Why this split

- **Hetzner for stateful LGTM:** predictable flat cost, NVMe for Prometheus TSDB,
  no per-series/per-GB metering surprises; full control over retention.
- **Railway Alloy sidecar:** keeps scrape/OTLP latency low to `apps/api` and lets
  log drains stay inside Railway before egress.
- **Vercel BFF embed proxy:** the only component that needs public exposure, and it
  already co-locates with the Next.js dashboards that render the panels.
