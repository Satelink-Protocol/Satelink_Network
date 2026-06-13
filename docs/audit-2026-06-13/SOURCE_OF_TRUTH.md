# SOURCE OF TRUTH — Forensic Reality Audit

**Date:** 2026-06-13
**Method:** Evidence-only. Every claim cites a code line, curl response, or git output. No claim rests on documentation.
**Auditor branch:** `fix-paperclip-auth` (audit work committed on `worktree-audit-2026-06-13`, branched from `origin/main` @ `dc04b11`)

---

## 1. GIT STATE

- Working branch at audit start: `fix-paperclip-auth`, HEAD `478ab53` (upstream gone — branch is local-only, deleted on remote).
- `origin/main` HEAD is **`dc04b11`** ("fix: correct claude CLI auth self-test flag", PR #124) — **ahead** of `fix-paperclip-auth`. Main already contains the paperclip credentials fix (PRs #123, #124) that `fix-paperclip-auth` (`478ab53`) was independently solving.
- Remote branches (4): `add-satelink-polygon-rpc` (PROTECTED — chainlist), `develop`, `fix-paperclip-auth-test`, `main`.
- Untracked at start: `anthropic_admin_check.sh`, `apps/web/node_modules`.

## 2. REPO SIZE / BLOAT

- Total working dir: **5.6 GB**. `node_modules/` = 1.3 GB (NOT in git — `git ls-files | grep node_modules` = **0**).
- `.claude/worktrees/` = **2.4 GB** across 7 leftover worktrees (`fix-nav-links`, `fix-paperclip-auth`, `frontend-rebuild`, `master-audit-2026-06-04`, `piped-cooking-sutherland`, `satelink-p0-security`, `silent-fixes`). Local disk only; not committed.
- Build artifacts in git: `.next/` = 0, `dist/` = 0. **None committed.**
- Largest blob in git history: `apps/api/satelink.db-wal` (3.9 MB) — present only in *history*, no longer tracked (`git ls-files` finds no `*.db-wal`). `.gitignore` now covers `*.db-wal`.
- No `.env` secrets committed — only `.env.example`, `.env.staging.example` are tracked.

**Verdict:** The audit brief's assumption that build artifacts/node_modules are committed is **FALSE**. `.gitignore` is already comprehensive (lines 16-161: node_modules, .next, dist, out, *.db, *.db-wal, .env*, .DS_Store).

## 3. SERVICES (verified by production smoke tests, 2026-06-13 ~08:34 UTC)

| Endpoint | Result | Evidence |
|---|---|---|
| `POST /rpc/polygon eth_blockNumber` | ✅ 200 | `{"result":"0x5453abe"}` (block 88,340,158) |
| `GET /health` | ✅ 200 | `{"ok":true,"server":"ok","db":"ok","uptime":14596}` |
| `GET /api/status` | ✅ 200 | `nodes_online:1, current_epoch:4012, total_requests_24h:25936, avg_latency_ms:85` |
| `GET /credits/initiate?amount=0.5` | ✅ 200 | Returns vault `0x80AF…`, USDT `0xc213…`, chainId 137, approve+deposit calldata |
| `GET https://agents.satelink.network/health` | ✅ 200 | `{"status":"ok"}` (Paperclip proxy alive) |
| `GET /system/settlement-anchor` | ✅ 200 | `started:true, configured:true, interval_minutes:10, last_result:{processed:0, skipped_below_threshold:4008}` |
| `GET /api/settlement/history` | ✅ 200 | Epochs CLOSED, **every `txHash:null`, `merkleRoot:null`** |
| `GET /system/free-tier` | ✅ 200 | `activeIPs:1121, totalCalls:609954, nearLimitIPs:66, limit:500` |

## 4. RUNTIME ENTRY POINT (server.js — ground truth)

- `apps/api/server.js` (621 lines) imports `createApp` from `./app_factory.mjs:14`. All core routes mounted in `app_factory.mjs` (confirms CLAUDE.md's load-bearing claim).
- Boot starts (server.js): epoch scheduler (`:431`), **DepositListener (`:441`)**, sentinel (`:449`), economy commander (`:458`), claim expiry (`:466`), treasury settlement 5min (`:476`), **settlement anchor 10min (`:487`)**, data retention (`:496`), DB cleanup (`:504`), self-heartbeat (`:572`).
- **Self-heartbeat hardcodes** node `NODE-ap-south-1-a09becbb` and falls back to wallet `0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3` (server.js:552-555). This is the source of `nodes_online:1` — the API server registers *itself* as the one node.

## 5. DEPLOY CONFIG — CONFLICTING (3 competing configs)

| File | Builder | Start command | Healthcheck |
|---|---|---|---|
| `railway.json` (root) | RAILPACK | `node apps/api/server.js` | `/` |
| `apps/api/railway.json` | DOCKERFILE | `node server.js` | `/health` |
| `nixpacks.toml` | nixpacks (node20) | `node server.js` | — |

`nixpacks.toml` rebuilds `better-sqlite3` from source — a dependency tied to the broken local-dev path. Which config wins depends on the Railway service's root-directory setting; this ambiguity is a latent deploy hazard.

## 6. SMART CONTRACT ADDRESSES (hardcoded in apps/api)

- USDT `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` — 12 occurrences (Polygon mainnet USDT, correct).
- RevenueVault `0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3` — 10 occurrences (matches deposit-initiate response; in production use).
- Zero address `0x0…0` — 5. Plus anvil/test addresses (`0xac0974…` = Hardhat test acct, `0x1111…`) present in source — minor hygiene note, not production-active.

## 7. ENV VARS THE CODE READS (selected critical)

`DATABASE_URL`, `REDIS_URL`, `POLYGON_RPC_URL`, `POLYGON_SIGNER_KEY`, `POLYGON_USDT_ADDRESS`, `POLYGON_CHAIN_ID`, `MIN_ANCHOR_REVENUE_USDT`, `REVENUE_VAULT_ADDRESS`, `TREASURY_ADDRESS`, `FREE_TIER_DAILY_LIMIT`, `MIN_DEPOSIT_USDT`, `ANTHROPIC_API_KEY` (paperclip), `SETTLEMENT_DRY_RUN`, `SETTLEMENT_EVM_*`. (Full list: 150+ vars — see Phase 1.3 grep.)

## 8. DATABASE ACCESS LIMITATION (important caveat)

Local `.env` `DATABASE_URL` points to **`127.0.0.1:5432/satelink`** (port **CLOSED** — local PG down). **No production DB connection string is available locally.** Therefore all DB-state numbers in this audit come from **production API endpoints** (which read the prod DB), not direct SQL. The audit brief's direct-`pg` queries cannot run from this environment — reality wins: API endpoints are the evidence source.
