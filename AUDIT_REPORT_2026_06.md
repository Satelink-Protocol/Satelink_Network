# Satelink Full-Stack Audit — June 2026

- **Generated:** 2026-06-26
- **Auditor:** Claude Code (Opus 4.8)
- **Verification method:** Live curl / Railway Postgres queries / file reads / git
- **Evidence tags:** `VERIFIED` (ran a command), `INFERRED` (read code, not executed), `NOT TESTED` (skipped, with reason)

> **Environment caveat (VERIFIED):** This audit ran inside the git worktree
> `.claude/worktrees/shadcn-studio-mcp-setup` (branch `worktree-shadcn-studio-mcp-setup`),
> NOT the main checkout. The harness forbids leaving the worktree. Live/DB findings are
> identical regardless (they hit production). Git/file-tree findings reflect this worktree,
> which carries unrelated in-progress **shadcn-studio MCP** changes
> (`apps/web/components.json`, `apps/web/next.config.ts`, untracked `apps/web/.vscode/`,
> `apps/web/CLAUDE.md`, `apps/web/src/components/shadcn-studio/`).

---

## 0. Environment (VERIFIED)
| Item | Value |
|------|-------|
| node | v24.13.0 |
| npm | 11.6.2 |
| psql | 14.22 (Homebrew) |
| Repo size | 1.9 GB |
| Local `.env` with secrets | **NONE** — only `.env.example`, `.env.staging.example`. Creds pulled from Railway CLI (authed as Satelink Network). |
| JS/TS source files | 918 |

---

## 1. Live System Status (VERIFIED — curl 2026-06-26 ~02:51 UTC)

`api.satelink.network`, `rpc.satelink.network`, and `admin.satelink.network` all resolve to the **same Express backend** (identical `/health`).

### 1.1 Backend (`api.` / `rpc.`)
| Endpoint | Status | Latency | Verdict |
|----------|--------|---------|---------|
| `/health` | 200 | 0.55s | PASS `{ok,server:ok,db:ok,uptime:19001}` |
| `/api/status` | 200 | 0.78s | PASS — nodes_online:1, epoch:35300, **14,869 req/24h**, 85ms avg |
| `/stats/free-tier` | 200 | 0.86s | PASS — **1,463 active IPs**, 14,870 calls, limit 500 |
| `/credits/deposit/initiate?amount=1` | 200 | 0.81s | PASS — returns vault calldata (vault `0x80AF…`, USDT `0xc213…`, chain 137) |
| `/status`, `/network-stats`, `/` | 404 | — | Bare paths don't exist (documented path is `/api/status`) |
| `/admin/*` (no token) | 401 | — | Auth gate active — `{"ok":false,"error":"Unauthorized"}` |

### 1.2 `app.satelink.network` (Next.js frontend)
| Endpoint | Status | Verdict |
|----------|--------|---------|
| `/` | 307 | Redirect (landing) |
| `/dashboard` | 404 | Route does not exist |
| `/api/health` | 404 | No such API route |

### 1.3 `admin.satelink.network`
| Endpoint | Status | Verdict |
|----------|--------|---------|
| `/` | 307 | Redirect |
| `/health` | 200 | Same backend as API (db:ok) |

---

## 2. Database State (VERIFIED — Railway Postgres `Postgres-iQeW`, 32 tables, 304 MB)

### 2.1 Critical table inventory
| Table | Rows | Note |
|-------|------|------|
| `epochs` | 35,248 | Scheduler running ~every 10 min |
| `epoch_ledger` | 35,248 | |
| `developer_intel` | 23,792 | Demand/lead intelligence (601 classified developers) |
| `node_health_logs` | 7,250 | |
| `settlement_batches` | 2,053 | See §2.4 |
| `api_credits` | 17 | 16 free + 1 basic |
| `credit_deposits` | 2 | |
| `auth_users` | 2 | |
| `api_deposits` | 1 | 0.59993 USDT |
| `revenue_events_v2` | **1** | See §2.2 |
| `registered_nodes` | 1 | |
| `nodes` | 0 | |
| `treasury_settlements` | 0 | Empty |
| `machine_access_tokens` | 0 | |

### 2.2 Revenue state — **REAL REVENUE ≈ $0 (VERIFIED)**
- `revenue_events_v2`: **1 row total**, `is_test_data=false`, amount **0.00003 USDT**, epoch 29077 (stale vs current 35301).
- `SUM(amount_usdt) WHERE is_test_data=false` = **0.000030 USDT**.
- This confirms the "phantom revenue" conclusion of `docs/audit-2026-06-21-customer-zero/`. The 14,869 req/24h and 1,463 active IPs convert to **zero billed revenue** — traffic is ~100% free-tier.

### 2.3 Credit state
- `api_credits`: 17 keys. `SUM(credits_usdt)=0.59987`, `SUM(total_deposited)=0.59993`, `SUM(total_spent)=0.00006`.
- Interpretation: one near-Customer-Zero deposited ~$0.60 and consumed $0.00006.

### 2.4 Settlement state — DRY-RUN, mostly unfunded (VERIFIED)
- `settlement_batches`: **1,954 `blocked_unfunded`** ($294.29 attempted), **98 `confirmed`** ($14.78, all with real tx_hashes), 1 `pending` ($0.15).
- Confirmed batches are epoch **rollups** (~$0.15 each) with on-chain tx hashes (e.g. `0x4cc2ac87…`).
- `treasury_settlements`: 0 rows. `treasury_state`: all zeros.
- **`/admin/settlement/status` reports `dryRun:true`, `signerBalance:null`** (signer `0x988f…`, treasury `0x966E…`, threshold 0.5 USDT). Settlement is **not broadcasting in real mode**, and the signer balance is unreadable → explains the 1,954 blocked_unfunded.
- **Reconciliation gap:** settled amounts do NOT trace to `revenue_events_v2` (1 row, $0.00003). The $14.78 "settled" derives from internally-aggregated epoch data, not real customer billing.

---

## 3. Backend Route Inventory (VERIFIED via `app_factory.mjs` + live curl)

### 3.1 Live mounts (the ONLY routes the running server exposes)
All mounted in `apps/api/app_factory.mjs` (load-bearing). Auth column = INFERRED from middleware on the mount line.

| Mount | Source | Auth |
|-------|--------|------|
| `/api/auth` | createUnifiedAuthRouter | — |
| `/auth` | createAuthController / createUserAuthRouter | — |
| `/rpc` | createRpcGateway | freeTierGate |
| `/rpc/mev` | createMevRelayRouter | — |
| `/v1/credits`, `/v1/vault`, `/v1`, `/v1/tools` | deposit/vault/AI-gateway/langchain | — |
| `/api/bandwidth` | createBandwidthRouter | — |
| `/.well-known`, `/openapi.json` | plugin manifest / openapi | — |
| `/api/keys` | createSimpleApiKeysRouter | — |
| `/api` | revenueRoutes + sdkAnalytics | — |
| `/api/nodes` | nodeRegistry + claims | — |
| `/api/settlement` | settlementAudit | — |
| `/api/webhooks`, `/api/oracle`, `/os` | webhooks/oracle/os-events | — |
| `/machine-access/v1` | machineAccess | — |
| `/api/admin` | createAdminMalRouter | — |
| `/api/financial` | financialTruth | — |
| `/credits` | createCreditsRouter | — |
| `/api/deposit` | depositNotify | — |
| `/admin` | createAdminRouter | **requireAdminAuth (x-admin-token)** |

### 3.2 Real `/admin/*` endpoints (VERIFIED — `src/admin/admin_router.js`, token-tested)
10 endpoints, all return real data with a valid `X-Admin-Token`:
`GET /admin/intel/developers`, `POST /admin/intel/classify`, `GET /admin/intel/abuse-overview`,
`GET /admin/outreach/campaigns`, `POST /admin/outreach/discord/post`,
`GET /admin/settlement/status`, `POST /admin/settlement/dry-run`,
`GET /admin/jobs/status`, `POST /admin/jobs/trigger/:jobId`, `GET /admin/live/feed` (SSE).

### 3.3 Missing observer endpoints (VERIFIED 404 *after* auth passes)
The 15 paths the admin frontend conceptually needs do **not** exist. Confirmed missing (valid token → 404 "Cannot GET"):
`/admin/revenue/summary`, `/admin/treasury/status`, `/admin/nodes/list` — and by extension the rest of the prompt's 15 (revenue/events, demand/leads, network/health, providers/status, agents/status, security/threats, billing/credits, incidents, audit-log, config).

### 3.4 Dead routes (VERIFIED — written but NOT mounted)
- `src/gateway/routes.js` and `src/core/routes.js` (two route aggregators) are **imported nowhere live**.
- They import **24 `src/gateway/routes/admin_*.js` files** (admin_revenue, admin_economics, admin_network, admin_growth, admin_control_room_api, admin_system, admin_forensics, admin_flywheel, admin_genesis, admin_launch, admin_lifecycle, admin_partners, admin_reputation, admin_sla, admin_workloads, admin_distributors, admin_autonomous, admin_api_v2, …).
- → A large pre-built admin API surface exists but is **completely unwired**. (Note: individual files like `gateway/routes/auth_v2.js` and `gateway/routes/api_phase3.js` ARE imported directly and are live.)

---

## 4. Frontend Status (VERIFIED — file inventory; build NOT run, see §4.3)

### 4.1 Page inventory — 40 `page.tsx`, **two parallel admin UIs**
- **`(admin)/admin/*`** (13): page, abuse, diagnostics/{incidents,self-tests}, ledger, nodes, revenue, revenue/events, rewards/epochs, security, security/audit, settings, users.
- **`satelink/os/(metering)/*`** (13): overview, mission-control, revenue-ops, settlement-lifecycle, billing, deposit, keys, usage, nodes, monitoring, customer-zero, agent-fleet.
- **`(builder)/*`** (4), **`(node)/*`** (4), **`(distributor)/*`** (2), plus `/admin/command-center`, `/login`, `/docs`, `/` (root).

### 4.2 API wiring (INFERRED from grep)
- `/admin/command-center` → `/api/admin-proxy` (injects `ADMIN_TOKEN` server-side) → calls the **real** endpoints (`/intel/*`, `/jobs/*`, `/settlement/status`). **Properly wired.**
- `(admin)/admin/*` group → calls `/api/revenue`, `/api/nodes`, `/api/revenue/events` directly.
- Base URL: `rpc.satelink.network` (8 refs) / `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_API_BASE`.
- **Hygiene bug (VERIFIED):** `apps/web/src/app/api/admin-proxy/route.js` logs the admin token prefix via `console.log("[DEBUG Proxy] ADMIN_TOKEN configured? ... (${token?.substring(0,6)}...)")`. Remove.

### 4.3 Build status — **NOT TESTED (deliberate)**
`next build` was not run. Reason: this worktree carries in-progress shadcn-studio changes (`next.config.ts`, `components.json` modified; new `src/components/shadcn-studio/`), so a build result would conflate incomplete shadcn setup with real app state. Re-run in a clean main checkout for a trustworthy result.

---

## 5. Admin Dashboard Gap Analysis

### 5.1 Works (wired + backend exists)
- `/admin/command-center` (intel, jobs, settlement status, live feed) — VERIFIED live.

### 5.2 Exists but backend missing/partial
- `(admin)/admin/revenue`, `/revenue/events`, `/nodes`, `/ledger`, `/rewards/epochs`, `/security/audit`, `/users`, `/abuse`, `/diagnostics/*` — depend on `/admin/{revenue,treasury,nodes,…}` paths that **404** (§3.3). Data partly recoverable from the 24 dead `admin_*` files (§3.4) if wired.

### 5.3 Missing entirely
- No backend for: providers/status, agents/status (agents service is **FAILED**, see §8), security/threats, billing/credits, incidents, audit-log, config — as discrete observer endpoints.

### 5.4 Priority build order
- **P1:** Wire `/admin/revenue/*` + `/admin/nodes/*` (UI already present) — reuse logic from dead `admin_revenue.js`/`admin_network.js`.
- **P2:** treasury/settlement summary endpoint surfacing the dry-run + blocked_unfunded state.
- **P3:** security/incidents/audit/config endpoints.

---

## 6. Observer API Endpoint Spec (frontend need → backend status)
| Dashboard Page | Needed Endpoint | Method | Auth | Status |
|---|---|---|---|---|
| Executive | `/admin/executive/summary` | GET | x-admin-token | MISSING |
| Revenue | `/admin/revenue/summary`,`/events` | GET | x-admin-token | MISSING (dead code exists) |
| Demand | `/admin/intel/developers` | GET | x-admin-token | **LIVE** |
| Network | `/admin/network/health` | GET | x-admin-token | MISSING (dead code exists) |
| Providers | `/admin/providers/status` | GET | x-admin-token | MISSING |
| Nodes | `/admin/nodes/list` | GET | x-admin-token | MISSING |
| Billing | `/admin/billing/credits` | GET | x-admin-token | MISSING |
| Treasury | `/admin/settlement/status` | GET | x-admin-token | **LIVE** (dryRun) |
| Customers | `/admin/customers/list` | GET | x-admin-token | MISSING (customer-zero via `/jobs`) |
| Agents | `/admin/agents/status` | GET | x-admin-token | MISSING (service FAILED) |
| Security | `/admin/intel/abuse-overview` | GET | x-admin-token | **LIVE** |
| Observability | `/admin/observability/metrics` | GET | x-admin-token | MISSING |
| Incidents | `/admin/incidents` | GET | x-admin-token | MISSING |
| Config | `/admin/config` | GET | x-admin-token | MISSING |
| Audit | `/admin/audit-log` | GET | x-admin-token | MISSING |

---

## 7. Dead File Manifest (REVIEW REQUIRED — nothing deleted)
| Candidate | Evidence | Recommendation |
|---|---|---|
| `src/gateway/routes.js` | imported nowhere live (VERIFIED) | Review then delete |
| `src/core/routes.js` | imported nowhere live (VERIFIED) | Review then delete |
| 24× `src/gateway/routes/admin_*.js` | only referenced by the two dead aggregators | Either WIRE (to fill §3.3 gaps) or delete — high value if wired |
| 150+ `.md` files | sprawl across `agent/memory/`, `docs/`, root | Consolidate (Phase 11) — not safe to bulk-delete |

> No deletions performed. Phase 10 not executed (see "Decision required" below).

---

## 8. Service / Git Health (VERIFIED)
- Railway services: `Satelink-api` ● Online, `Postgres-iQeW` ● Online, `Paperclip-DB` ● Online, **`Satelink_Paperclip` ● FAILED** (agents.satelink.network down — the 12 Paperclip agents are offline).
- Branch: `worktree-shadcn-studio-mcp-setup` (✅ not the protected `add-satelink-polygon-rpc`).
- Working tree dirty with shadcn-studio MCP changes (unrelated to this audit).

---

## 9. Codebase Hygiene (VERIFIED)
- `console.log`: 180 files under `apps/{api,web}/src`. Notable: token-prefix leak in admin-proxy (§4.2).
- TODO/FIXME/HACK/XXX: 10 occurrences.
- Large non-vendor files: only lock files + an OpenZeppelin audit PDF — fine.
- `SETTLEMENT_DRY_RUN`: 3 files (`settlement_control.js`, `settlement_anchor_job.js`, `treasury_settlement_job.mjs`). Live state = dry-run (§2.4).

---

## 10. Recommended Actions (priority ordered)
**P0 (blocks revenue):**
1. Resolve settlement **dry-run + `signerBalance:null`** — fund/enable the signer so the 1,954 blocked_unfunded batches can settle (or confirm dry-run is intentional and stop generating unfunded batches).
2. Decide the **billing-conversion** problem: 14.8k req/day → $0 billed. Free-tier gate vs. paid conversion is the core revenue gap.
3. Restart/repair **`Satelink_Paperclip`** (FAILED) if agents are needed.

**P1:**
4. Wire `/admin/revenue/*` and `/admin/nodes/*` from the existing dead `admin_*.js` files to light up the admin UI.
5. Remove the admin-proxy token-prefix `console.log`.

**P2:** Build remaining observer endpoints (§6). Then delete the two dead aggregators + unused `admin_*.js`.

**P3:** Consolidate the 150+ `.md` files; address `is_test_data` reconciliation in `revenue_events_v2`.

---

## 11. Source-of-Truth `.md` Map (current reality)
- `CLAUDE.md` — agent master context (**stale** per memory: claims signer set/anchor live; live state is dry-run).
- `docs/audit-2026-06-13/` + `docs/audit-2026-06-21-customer-zero/` — most recent prior audits; phantom-revenue + customer-zero analysis. **This report supersedes their live numbers as of 2026-06-26.**
- `agent/memory/events/ACTIVE_EVENTS.md` — open work items.

---

## Decision Required (Phases 9–11 NOT executed)
Per the prompt's own gating ("do not start Phase 9 until Phase 8 is complete"), the audit pauses here.
Phases 9 (backend route reorg), 10 (deletions), and 11 (.md consolidation) are **destructive/large** and were intentionally NOT run because:
1. This is the **shadcn-studio worktree** — a backend reorg + deletions here would mix with unrelated in-progress work.
2. The prompt's target `src/routes/admin/` structure conflicts with the live `src/admin/admin_router.js` + `gateway/routes/*` reality — a blind reorg risks breaking the load-bearing `app_factory.mjs`.
3. The "missing" observer endpoints largely **already exist as dead code** — wiring is lower-risk than rewriting.

Recommend running 9–11 on a dedicated clean branch off `main`, not this worktree.
