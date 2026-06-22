# Grafana Cloud Setup — Satelink Monitoring

The Monitoring page (`/satelink/os/monitoring`) embeds Grafana panels through a
server-side proxy (`apps/web/src/app/api/grafana/[...path]/route.ts`). Until
Grafana is connected, every panel shows a clean **"Monitoring Coming Soon"**
empty state — the native KPI strip at the top (requests, latency, nodes, vault)
is always live regardless of Grafana.

To light up the panels, connect a free Grafana Cloud stack and set two env vars.

---

## 1. Create a free Grafana Cloud account

1. Go to <https://grafana.com> and **Create free account** (1 free stack, no
   credit card required).
2. Your stack URL is your **`GRAFANA_URL`** — e.g. `https://yourstack.grafana.net`.

## 2. Create a service-account token (read-only)

In your Grafana stack:

1. **Administration → Service Accounts → Create**.
2. Assign the **Viewer** role (read-only is all the embed proxy needs).
3. **Create Token** and copy it. This value is your **`GRAFANA_TOKEN`**.

> Keep the token secret — it is used server-side only and never reaches the browser.

## 3. Add the env vars in Vercel

In the Vercel dashboard → project **"web"** → **Settings → Environment
Variables → Add**:

| Key            | Value                                | Environment   |
| -------------- | ------------------------------------ | ------------- |
| `GRAFANA_URL`  | `https://yourstack.grafana.net`      | Production    |
| `GRAFANA_TOKEN`| `<service account token>`            | Production    |

Set both for the **Production** environment only.

## 4. Redeploy

Changing environment variables triggers a Vercel auto-deploy. Once the new
deployment is live, the Monitoring page panels switch from the empty state to
real Grafana embeds automatically — no code change required.

---

## 5. Add the Satelink Prometheus data source

The gateway already exposes real metrics in Prometheus text format. Use this as
the data source for the dashboards your panels point at.

In Grafana: **Connections → Data sources → Add data source → Prometheus**, then:

- **URL:** `https://rpc.satelink.network/rpc/metrics/prometheus`

This endpoint is **already live** (verified HTTP 200) and serves real gateway
metrics — request throughput, latency, error counts, and free-tier pressure.
No additional exporter or agent is required.

### Dashboard UIDs

The Monitoring page builds embed URLs from these dashboard UIDs (overridable per
environment via `NEXT_PUBLIC_GRAFANA_UID_*` build-time vars; defaults shown):

| Section            | Default UID                   |
| ------------------ | ----------------------------- |
| Platform Overview  | `satelink-exec-overview`      |
| RPC Health         | `satelink-rpc-throughput`     |
| Provider Health    | `satelink-network-health`     |
| Revenue Metrics    | `satelink-tenant-usage`       |
| Settlement Metrics | `satelink-settlement-epochs`  |
| Alerts             | `satelink-alerts`             |

Create dashboards in Grafana with these UIDs (or set the matching
`NEXT_PUBLIC_GRAFANA_UID_*` env vars to your own UIDs) so each embedded panel
resolves to a real dashboard.

---

## How it fails safe

- The browser never talks to Grafana directly — all panel/asset requests go
  through the same-origin proxy, so `GRAFANA_URL` and `GRAFANA_TOKEN` stay
  server-only.
- When the vars are unset, the proxy returns `503` and the `GrafanaPanel`
  component renders the **"Monitoring Coming Soon"** empty state — never raw
  JSON, error codes, or configuration instructions.
- The top KPI strip is sourced from the gateway API directly and is unaffected
  by Grafana configuration.
