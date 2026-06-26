# Satelink API Reference
Last verified: 2026-06-26. Backend: single Express app (`apps/api/app_factory.mjs`) served at
`api.satelink.network` == `rpc.satelink.network` == `admin.satelink.network`.

## Authentication
- **Public RPC / credits / nodes:** no admin auth (free-tier gated by IP).
- **Admin routes (`/admin/*`):** `X-Admin-Token: <ADMIN_SECRET_TOKEN>` header
  (`requireAdminAuth`, `apps/api/src/admin/admin_router.js`). Read the token via
  `railway variables --service Satelink-api --kv` (use the value **as-is**). The frontend
  injects it server-side through `/api/admin-proxy` (Next.js route) so it never reaches the browser.
- **User routes:** JWT (`requireJWT` / `requireRole`).

## Public endpoints (VERIFIED live)
| Endpoint | Method | Notes |
|---|---|---|
| `/health` | GET | `{ ok, server:ok, db:ok, uptime }` |
| `/api/status` | GET | nodes_online, current epoch, ~req/24h, avg latency |
| `/stats/free-tier` | GET | active IPs, calls, free-tier limit (500) |
| `/credits/deposit/initiate?amount=<usdt>` | GET | ABI calldata, vault `0x80AF…`, USDT `0xc213…`, chain 137 |
| `/credits/initiate?amount=<usdt>` | GET | same handler |
| `/rpc` | POST | RPC gateway (freeTierGate) |
| `/api/keys`, `/api/nodes`, `/v1/*`, `/api/settlement`, `/api/bandwidth` | — | mounted in `app_factory.mjs` |

## Admin — Live endpoints (10, VERIFIED 2026-06-26)
All require `X-Admin-Token`.
- `GET /admin/intel/developers` — demand leads (developer+machine, by score)
- `POST /admin/intel/classify` — run IP classifier
- `GET /admin/intel/abuse-overview` — classification summary, top abusers, subnet hotspots
- `PATCH /admin/intel/developer/:ip/stage` — move a lead through the funnel
- `GET /admin/outreach/campaigns` — outreach pipeline
- `POST /admin/outreach/discord/post` — Discord post
- `GET /admin/settlement/status` — `{ dryRun, signerBalance, signerAddress, treasuryAddress, threshold, … }`
- `POST /admin/settlement/dry-run` — toggle dry-run (env-level; **do not enable live settlement**)
- `GET /admin/jobs/status` — last result per automation job
- `POST /admin/jobs/trigger/:jobId` — run `ip-classifier` | `customer-zero` | `outreach`
- `GET /admin/live/feed` — SSE stream of automation logs

## Admin — Observer endpoints (18, added Phase 9 on `satelink/admin-observer-wiring-2026-06`)
Read-only. Contract: `{ ok:true, data:{…}, ts }` / error `{ ok:false, error, ts }`. Tagged
`// OBSERVER` in `admin_router.js`. **SQL-validated against prod Postgres**; deploys on merge to main.

| Endpoint | Returns (data) |
|---|---|
| `GET /admin/executive/summary` | revenue_today/mtd, active_ips_24h, total_requests_24h, paying_customers, settlement_mode, signer_balance_pol, network_health_pct, open_alerts, top_risks[] |
| `GET /admin/revenue/summary` | today/mtd/total_real usdt, events/test/real counts, billing_rate, free_tier_calls_24h |
| `GET /admin/revenue/events` | last N `revenue_events_v2` (paginated `?limit&offset`) |
| `GET /admin/revenue/funnel` | requests_24h, billable_24h, revenue_events_24h, credits_consumed_usdt, settled_usdt, withdrawable_usdt |
| `GET /admin/demand/leads` | alias of `/intel/developers` |
| `GET /admin/demand/stats` | machine/developer/unknown/scanner counts, total_active_ips, top_lead |
| `GET /admin/network/health` | availability_pct, p50_latency_ms, error_rate_pct, requests_24h, active_nodes, chain_status[] |
| `GET /admin/nodes/list` | nodes[] (id, region, uptime, reputation, jobs_executed, status), totals |
| `GET /admin/billing/credits` | total/free/paid keys, deposited/spent/outstanding usdt, deposits[] |
| `GET /admin/treasury/status` | dry_run, signer_balance_pol, addresses, batch counts/usdt by status, threshold_met |
| `GET /admin/customers/list` | paying[], free_tier[], total_paying |
| `GET /admin/agents/status` | honest FAILED report (Satelink_Paperclip offline) |
| `GET /admin/security/threats` | top scanner/unknown/high-volume IPs from `developer_intel` |
| `GET /admin/security/classifier-stats` | machine/developer/unknown/scanner/total |
| `GET /admin/observability/metrics` | cpu_pct, memory_mb, uptime_s, db/redis status, api_p50_ms, requests_24h |
| `GET /admin/incidents` | STATIC historical incidents (INC-012/013/014) |
| `GET /admin/audit-log` | `admin_audit_log` rows, or `[]` + note (table not yet created) |
| `GET /admin/config` | sanitized config (key names + non-secret values only) |

## Dead routes removed (Phase 10)
`src/gateway/routes.js`, `src/core/routes.js`, and 18 `src/gateway/routes/admin_*.js`
(network, launch, workloads, genesis, distributors, partners, flywheel, growth, lifecycle,
reputation, economics, sla, system, autonomous, forensics, control_api, revenue,
control_room_api) — all had zero live imports. `admin_api_v2.js` kept (orphan import edge).
