# Satelink — AI Agent Master Context
Last verified: 2026-07-16 (consolidation session — git rescue + docs truth pass).
Every agent reads this FIRST. Rows marked (2026-07-16) are curl/railway-verified live;
older rows retain their original verification date.

---

## Project Identity
Machine-commerce RPC gateway on **Polygon PoS Mainnet (chainId 137)**: machines and AI
agents pay per call for blockchain RPC APIs (`eth_getBalance`, `eth_call`, …). Two live
payment rails: **x402** (USDC on Base `eip155:8453` via CDP facilitator, mainnet-proven)
and **USDT credit deposits** (RevenueVaultV2 on Polygon). Flat rate $0.00003/call;
x402 bundle $0.10 = 1,000 calls. Revenue target: $500/hr collected on-chain.

## Repository
`/Users/pradeepjakuraa/satelink` (monorepo)
GitHub: https://github.com/Satelink-Protocol/Satelink_Network
> `CLAUDE.md` at repo root is a symlink → `.claude/CLAUDE.md` (this file is the real target).

## Stack
- Backend: Node.js/Express (`apps/api`), Railway, `api.satelink.network` / `rpc.satelink.network` / `admin.satelink.network` (all the same Express backend)
- Frontend: Next.js (`apps/web`), Vercel, `satelink.network` (**`app.satelink.network` is DEAD — 404, verified 2026-07-16; never link it**)
- DB: Postgres (`Postgres-iQeW`, 304 MB, 32 tables) + Redis on Railway
- Contracts: Solidity/Foundry, Polygon mainnet

---

## VERIFIED PRODUCTION STATE
| Signal | Value |
|--------|-------|
| Traffic (2026-07-16) | **496,273 req/24h** (`/admin/observability/metrics`), p50 46ms; 1,338 active IPs today of 70,608 tracked (`/admin/demand/stats`) |
| Classification, all-time (2026-07-16) | machine 48,647 / developer 3,435 / unknown 18,524 / scanner 2 |
| x402 rail (2026-07-16) | **LIVE** — `X402_ENABLED=true`, network `eip155:8453` (Base), payTo `0x966E…7Ad4`; mainnet settlements proven (see `docs/x402-bazaar-escalation.md`) |
| Deposits vault (2026-07-16) | **RevenueVaultV2** `0x577D3716d6Ad5b676d230f5409deF9838FABaCEF` (`VAULT_ADDRESS` + `REVENUE_VAULT_ADDRESS`); V1 `0x80AF…DdA3` is legacy |
| Deploys (2026-07-16) | Railway auto-deploy from `main` green (latest SUCCESS 07:08 IST) |
| Test baseline (2026-07-16) | `apps/api`: **128 passing / 9 failing** — the 9 are pre-existing: DepositListener cursor-resume, EpochScheduler close/split, freeTierGate anon-402, instant-key t1–t3, Withdrawal API ×3. Any NEW failure = regression. Run with `npx mocha --no-config --exit 'test/**/*.test.js'` (`.mocharc` file bug + hanging handles) |
| Revenue | All pre-2026-07-11 “revenue” was founder test data (war room 2026-07-11); real paid conversion still ~zero — verify on-chain before quoting any number |
| Settlement | `SETTLEMENT_DRY_RUN=1` — still not broadcasting; do not change (see guards below) |
| Log noise (2026-07-16) | `[FreeTierGate] Subnet blocked` logs per blocked request (subnet 34.92.84 blocked 2.09M times) — fix requires touching forbidden `free_tier_gate.js`; founder decision |

## Key Addresses (Polygon 137 unless noted)
- **RevenueVaultV2 (current)**: `0x577D3716d6Ad5b676d230f5409deF9838FABaCEF` — permissionless deposit; migrated in PR #234
- RevenueVault V1 (legacy): `0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3`
- USDT: `0xc2132D05D31c914a87C6611C10748AEb04B58e8F`
- Treasury / x402 payTo (also on Base): `0x966E1Ae22996545015b1414B35234b10719d7Ad4`
- Signer: `0x988fb0efC0f14111511dE3481E6c066018A0cf91` (verify balance before enabling settlement)

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
> Status: **DEPLOYED and live** (curl-verified 2026-07-16: `/admin/demand/stats` and
> `/admin/observability/metrics` return live data). See `docs/ADMIN_DASHBOARD.md`.

## Dead Files Removed (Phase 10)
Deleted 20 dead route files (zero live imports): `src/gateway/routes.js`, `src/core/routes.js`,
and 18 `src/gateway/routes/admin_*.js` (network, launch, workloads, genesis, distributors,
partners, flywheel, growth, lifecycle, reputation, economics, sla, system, autonomous,
forensics, control_api, revenue, control_room_api). **Kept** `admin_api_v2.js` (still imported
by the orphan `unified_dashboard_api.js`). Backend `console.log` blanket-sweep deliberately
NOT done (high-risk, unreviewable) — see `docs/SECURITY.md`.

---

## Git State (canonical, set 2026-07-16 consolidation)
- **`main` is the single source of truth**; deploy = merge to `main` (Railway + Vercel auto).
- Long-lived branches (only these are justified): `add-satelink-polygon-rpc` (protected,
  Chainlist PR #8314 source — never commit to it), `wip/local-attribution-mcp-2026-07-16`
  (unreviewed WIP snapshot: partner-attribution tracking + early mcp-server draft).
- Every deleted branch has an `archive/<name>` tag pushed to origin — restore with
  `git switch -c <name> archive/<name>`. Do not delete branches without such a tag.
- `git stash` entry "PRESERVED-2026-07-16" holds a RevenueVaultV2.sol source variant
  (immutable usdt + full natspec — possibly the deployed source of `0x577D…BaCEF`);
  local-only, founder to reconcile against Polygonscan verified source.
- Open PRs stay open only with a stated reason (see PR comments on #257, #249–#251).

## P0 Items (block Customer Zero)
1. ~500k req/day at ~$0 billed — conversion from free tier is THE problem (war room 2026-07-11;
   PRs #241/#243–#248/#254 shipped the funnel — measure before building more).
2. Signer `0x988f…` — verify balance before any settlement change.
3. x402 Bazaar discoverability: PR #257 (method-level description) awaits founder merge;
   `docs/x402-bazaar-escalation.md` is drafted, ready to send.

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
