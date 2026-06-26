# Satelink — AI Agent Master Context
Last verified: 2026-06-26 (AUDIT_REPORT_2026_06.md + Phase 9–11 wiring branch).
Every agent reads this FIRST. All numbers below are psql/curl-verified against production.

---

## Project Identity
DePIN RPC gateway on **Polygon PoS Mainnet (chainId 137)**: machines pay USDT to call
blockchain RPC APIs (`eth_getBalance`, `eth_call`, …) routed through a permissionless node
network. Billing rate **$0.00003/call**. Settlement in USDT on-chain, aggregated per epoch
through the RevenueVault. Revenue target: $500/hr collected on-chain.

## Repository
`/Users/pradeepjakuraa/satelink` (monorepo)
GitHub: https://github.com/Satelink-Protocol/Satelink_Network
> `CLAUDE.md` at repo root is a symlink → `.claude/CLAUDE.md` (this file is the real target).

## Stack
- Backend: Node.js/Express (`apps/api`), Railway, `api.satelink.network` / `rpc.satelink.network` / `admin.satelink.network` (all the same Express backend)
- Frontend: Next.js (`apps/web`), Vercel, `app.satelink.network`
- DB: Postgres (`Postgres-iQeW`, 304 MB, 32 tables) + Redis on Railway
- Contracts: Solidity/Foundry, Polygon mainnet

---

## VERIFIED PRODUCTION STATE (2026-06-26)
| Signal | Value |
|--------|-------|
| `revenue_events_v2` real rows | **1** row, **$0.00003** USDT total (`is_test_data=false`, epoch 29077) |
| Revenue today / MTD | $0 / $0.00003 |
| `api_credits` | 17 keys (16 free, 1 paid); deposited $0.59993, spent $0.00006, outstanding $0.59987 |
| `settlement_batches` | **1,954 blocked_unfunded** ($294.29), 98 confirmed ($14.78), 1 pending ($0.15) |
| `epochs` | max id 35,387; 27,933 phantom of 35,331 |
| `developer_intel` | 23,859 rows — machine 19,421 / unknown 3,809 / developer 628 / scanner 1 |
| Demand | 5,957 IPs with calls today; ~101,814 calls_today aggregate; ~14.8k req/24h (Redis counter) |
| `registered_nodes` | **1** active (ap-south-1, chain 137); node health 24h: 100% healthy, p50 ~49ms |
| Settlement | `SETTLEMENT_DRY_RUN=1`, `signerBalance=null` — NOT broadcasting on-chain |
| Agents | **`Satelink_Paperclip` Railway service FAILED** — agents.satelink.network offline |
| Traffic → revenue | ~14.8k req/day convert to **$0 billed** — ~100% free-tier |

## Key Addresses (Polygon 137)
- RevenueVault: `0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3` (in production use, accepts deposits)
- USDT: `0xc2132D05D31c914a87C6611C10748AEb04B58e8F`
- Treasury: `0x966E1Ae22996545015b1414B35234b10719d7Ad4`
- Signer: `0x988fb0efC0f14111511dE3481E6c066018A0cf91` (`signerBalance=null` — check before enabling settlement)

## Settlement Guards
`SETTLEMENT_DRY_RUN=1` — **NEVER set to 0** without ALL of: (a) signer funded,
(b) real revenue > $0.50, (c) explicit human decision. `MIN_ANCHOR_REVENUE_USDT=0.5`.

---

## The Money Path (exact file locations — load-bearing)
```
HTTP request
  → apps/api/app_factory.mjs  freeTierGate middleware (rate-limits free IPs)
  → app.use("/rpc", freeTierGate, …, createRpcGateway(pool))
  → apps/api/src/workloads/rpc_gateway/   (RPC execution, proxies to Polygon nodes)
  → apps/api/src/routes/credits.js        (billing: credit deduction per call)
        GET /credits/deposit/initiate?amount=<usdt>  → ABI calldata
  → apps/api/src/economics/epoch_scheduler.js  (epoch aggregation, every ~10 min)
  → RevenueVault 0x80AF… (Polygon 137)
```
`server.js` imports `createApp` from `app_factory.mjs`. **ALL** core routes
(`/rpc`, `/api/keys`, `/v1`, `/api/nodes`, `/credits`, `/admin`, …) mount inside
`app_factory.mjs`. **DO NOT delete/refactor `app_factory.mjs` without migrating every route first.**
Admin router mounts at `app_factory.mjs:413` → `app.use("/admin", requireAdminAuth, …, createAdminRouter(pool, redis))`.

---

## Permanent Rules
- **NEVER `git add -A`** — stage files individually.
- **NEVER commit to `add-satelink-polygon-rpc`** (Chainlist PR #8314 source branch, protected).
- **NEVER run settlement without `SETTLEMENT_DRY_RUN=1`** confirmed; never set it to 0 autonomously.
- **NEVER modify `contracts/`** / any `.sol` without explicit instruction.
- **NEVER drop or truncate any Postgres table.**
- **NEVER delete `agent/memory/`** — persistent agent state.
- `ADMIN_SECRET_TOKEN`: read it from `railway variables --service Satelink-api --kv`
  (the unmodified value works as `X-Admin-Token`). The Railway **table** display truncates
  both ends — do not hand-copy from the table; use `--kv`.
- `1,878 TX` is a historical fact (INC-013). Must NEVER appear as a fabricated live UI metric.
- Claude Code scope: `apps/api` and `apps/web` only — never `contracts/`, never Railway env vars.

## Deploy Mechanism (IMPORTANT)
- **Code deploys ONLY by merging to GitHub `main`** → Railway (API) and Vercel (web) auto-deploy.
- **`railway redeploy` / `railway up` do NOT ship local/uncommitted code** — they restart the
  *same image*. Use them only to restart, never to "test" local changes.
- Local full-app boot is unsafe against prod DB (it starts the epoch scheduler + settlement
  anchor, which WRITE to prod). To verify endpoints locally, load only the router against
  prod Postgres read-only (see this branch's verification method).

---

## Admin API — Live Endpoints (10, verified 2026-06-26, `src/admin/admin_router.js`)
`X-Admin-Token` auth on every one:
`GET /admin/intel/developers`, `POST /admin/intel/classify`, `GET /admin/intel/abuse-overview`,
`PATCH /admin/intel/developer/:ip/stage`, `GET /admin/outreach/campaigns`,
`POST /admin/outreach/discord/post`, `GET /admin/settlement/status`,
`POST /admin/settlement/dry-run`, `GET /admin/jobs/status`,
`POST /admin/jobs/trigger/:jobId`, `GET /admin/live/feed` (SSE).

## Observer Endpoints — Added on branch `satelink/admin-observer-wiring-2026-06` (Phase 9)
18 read-only KPI endpoints, all `{ ok, data, ts }`, all SQL-validated against prod Postgres
(tagged `// OBSERVER` in `admin_router.js`):
`/admin/executive/summary`, `/admin/revenue/summary`, `/admin/revenue/events`,
`/admin/revenue/funnel`, `/admin/demand/leads`, `/admin/demand/stats`,
`/admin/network/health`, `/admin/nodes/list`, `/admin/billing/credits`,
`/admin/treasury/status`, `/admin/customers/list`, `/admin/agents/status`,
`/admin/security/threats`, `/admin/security/classifier-stats`,
`/admin/observability/metrics`, `/admin/incidents`, `/admin/audit-log`, `/admin/config`.
> Status: committed on the branch, **not yet deployed** (deploy = merge to main). Verified by
> invoking each handler against live Postgres (200 ok:true). See `docs/ADMIN_DASHBOARD.md`.

## Dead Files Removed (Phase 10)
Deleted 20 dead route files (zero live imports): `src/gateway/routes.js`, `src/core/routes.js`,
and 18 `src/gateway/routes/admin_*.js` (network, launch, workloads, genesis, distributors,
partners, flywheel, growth, lifecycle, reputation, economics, sla, system, autonomous,
forensics, control_api, revenue, control_room_api). **Kept** `admin_api_v2.js` (still imported
by the orphan `unified_dashboard_api.js`). Backend `console.log` blanket-sweep deliberately
NOT done (high-risk, unreviewable) — see `docs/SECURITY.md`.

---

## P0 Items (block Customer Zero)
1. Signer `0x988f…` balance is `null` — fund + verify before enabling settlement.
2. 14.8k req/day at $0 billed — free-tier gate lets ~all traffic through unpaid.
3. Rica Web Services (`38.49.212.250`, `support@servarica.com`) — outreach email not sent.
4. `Satelink_Paperclip` FAILED — restart in Railway dashboard.

## Canonical Docs (single source of truth, 2026-06-26)
`CLAUDE.md` (this file), `AUDIT_REPORT_2026_06.md`, and `docs/`:
`REVENUE.md`, `API_REFERENCE.md`, `ADMIN_DASHBOARD.md`, `OPERATIONS.md`, `SECURITY.md`,
`CUSTOMER_ZERO.md`, `FRONTEND.md`.

## Production URLs / IDs
- API: `https://api.satelink.network` (== `rpc.` == `admin.`)
- Frontend: `https://app.satelink.network`
- Railway project: `0312ce4a-fb7b-41be-b7c7-0d3dcfdc0f89` · API service `Satelink-api`
- Vercel project: `satelinkinternet-collabs-projects/web`

## Economic Model
50% node operators | 30% platform | 20% distribution pool. Settlement: USDT on Polygon,
aggregated per epoch, paid via RevenueVault.
