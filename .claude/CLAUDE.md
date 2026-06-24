# SATELINK AGENT BRAIN — MASTER CONTEXT
# Last updated: 2026-06-12 (system-state refresh — settlement anchor wired, nodes_online UPSERT fix, auth login fix, frontend rebuild)
# Every agent reads this FIRST. No exceptions.

---

## SECTION 1 — WHAT SATELINK IS

Satelink is a DePIN RPC gateway on Polygon: machines pay USDT to call blockchain APIs
(eth_getBalance, eth_call, etc.) routed through a permissionless node network.
Revenue target is $500/hr in collected USDT on-chain.
**Real external revenue: $0** as of 2026-06-12 — no paying customer deposits confirmed yet.
The on-chain settlement path is now wired end-to-end (anchor runs every 10 min) but cannot
submit transactions until `POLYGON_SIGNER_KEY` is set in Railway (see Section 4).

---

## SECTION 2 — THE MONEY PATH (exact file locations)

```
HTTP request
  → apps/api/app_factory.mjs line 241
      freeTierGate middleware (rate-limits free IPs, blocks over-limit, forces credit check)
  → apps/api/app_factory.mjs line 241
      app.use("/rpc", freeTierGate, express.json({limit:'1mb'}), createRpcGateway(pool))
  → apps/api/src/workloads/rpc_gateway/   (RPC execution — proxies to Polygon nodes)
  → apps/api/src/routes/credits.js        (billing: credit deduction per call)
      GET  /credits/deposit/initiate?amount=<usdt>   ← returns ABI calldata
      GET  /credits/initiate?amount=<usdt>           ← same handler, both paths live
  → epoch aggregation (apps/api/src/economics/epoch_scheduler.js)
  → RevenueVault 0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3 (Polygon Mainnet 137)
      USDT: 0xc2132D05D31c914a87C6611C10748AEb04B58e8F
```

`server.js` imports `createApp` from `./app_factory.mjs` at line 12.
All core routes (/rpc, /api/keys, /v1, /api/nodes, /credits, /api/bandwidth, /api/settlement)
are mounted inside `app_factory.mjs`, not `server.js` directly.
**DO NOT delete or refactor app_factory.mjs without migrating all routes first.**

---

## SECTION 3 — WHAT IS LIVE AND WORKING (verified 2026-06-12)

| Component | Status | Notes |
|----------|--------|-------|
| `GET https://rpc.satelink.network/health` | LIVE | `{"ok":true,"server":"ok","db":"ok"}` |
| `GET https://rpc.satelink.network/api/status` | LIVE | operational; `nodes_online: 1` (UPSERT fix deployed 2026-06-12) |
| `GET https://rpc.satelink.network/stats/free-tier` | LIVE | free-tier counters |
| `GET https://rpc.satelink.network/credits/deposit/initiate?amount=1` | LIVE | Returns ABI calldata, vault addr, gas estimates |
| `GET https://rpc.satelink.network/credits/initiate?amount=1` | LIVE | Same handler, both URL variants work |
| `GET https://app.satelink.network/satelink/os/deposit` | LIVE | Deposit page renders (HTTP 200) |
| RevenueVault on Polygon | VERIFIED | 0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3 — accepts deposits, credited within 1s (SAT-240 2026-06-05) |
| Settlement anchor | RUNNING | Wired 2026-06-12; runs every 10 min. **Cannot submit on-chain until `POLYGON_SIGNER_KEY` set in Railway** |
| Epoch scheduler | RUNNING | Epoch aggregation active |
| Auth login | FIXED | Vercel catch-all rewrite removed 2026-06-12 — `/satelink/os/*` login flow now works |
| Landing page | LIVE | Rebuilt from approved design 2026-06-12 (clean Next.js, `next build` script fixed, no root vercel.json) |
| Dashboard | LIVE | 6 sections, real data only, live at app.satelink.network |
| Paperclip agents | LIVE | 12 agents at agents.satelink.network via `claude_local` adapter |
| WebSocket gateway | MOUNTED | `/ws/stats` endpoint active |

---

## SECTION 4 — WHAT IS BROKEN OR INCOMPLETE (verified 2026-06-12)

### CRITICAL: Settlement cannot submit on-chain — `POLYGON_SIGNER_KEY` missing
- The settlement anchor is wired and runs every 10 min (2026-06-12) but has no signer.
- Set `POLYGON_SIGNER_KEY` in Railway env so the anchor can submit epoch settlement txs on-chain.
- Until then: epochs aggregate but no USDT settlement transaction is broadcast.

### Only 1 node online
- `nodes_online: 1` from `/api/status` (UPSERT fix deployed 2026-06-12 — count now persists correctly)
- One node is registered/serving; the network still needs more capacity for meaningful throughput
- Without a healthy node fleet: limited RPC execution, thin billing triggers, near-zero revenue

### Real external revenue: $0
- No paying customer deposit confirmed yet. Customer Zero still undefined (EVT-CUST-001).

### UNVERIFIED: Node registration end-to-end
- Route: `app_factory.mjs:263` → `app.use("/api/nodes", createNodeRegistryRouter(pool, redis))`
- Curl to `/v1/nodes/register` and `/api/keys` returns HTML (auth-gated — untested with valid token)
- No confirmed test of: register node → get approved → serve traffic → earn reward

### UNVERIFIED: Withdrawal/claim flow
- `ClaimsWithdrawals.sol` exists in contracts/ but no deployment record found
- `apps/web/src/app/satelink/os/withdraw/page.tsx` exists
- End-to-end (earn → claim → withdraw USDT) not confirmed working

### VERIFIED: RevenueVault contract deployment (SAT-240, 2026-06-05)
- Contract at `0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3` is VERIFIED accepting deposits
- Deposit tx: 0xd188cc0b248e94319d0012ef83a89f7a258d2dcf8a3cf11c3ec3ab68fa83fb71 (block 87932563)
- DepositListener credits within 1s; billing deducts at 0.00001 USDT/call
- Polygonscan: https://polygonscan.com/address/0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3

### Contracts with no confirmed deployment status
ClaimsContract.sol, ClaimsWithdrawals.sol, EligibilityPolicy.sol, EpochAnchor.sol,
GovernanceTimelock.sol, NodeRegistryV2.sol, RevenueDistributor.sol, SplitEngine.sol
(RevenueVault.sol is in production use; MockUSDT.sol is testnet-only)

### API key system (untested end-to-end)
- `app.use("/api/keys", createSimpleApiKeysRouter(pool))` at app_factory.mjs:257
- Curl to `/api/keys` returns HTML (auth-gated, not tested with valid auth token)
- Customers cannot use credits without a working API key after depositing

### Local dev broken (EVT-OPS-001 ACTIVE)
- Local API is unreachable due to better-sqlite3 error chain
- All functional testing must be done against production URLs

---

## SECTION 5 — REVENUE GAPS (honest assessment)

**Single biggest lever right now:**
Chainlist PR #8314 (pending @ligi review) — listing Satelink's RPC on chainlist.org is a
~395x traffic lever. Approval routes a large volume of organic RPC traffic to the gateway,
which is the fastest path from "1 node, $0 revenue" to real billed calls.

**3 fixes most likely to bring the first dollar of real revenue:**

1. **Set `POLYGON_SIGNER_KEY` in Railway** so the settlement anchor can submit on-chain.
   - The anchor runs every 10 min but is a no-op without a signer.
   - Without it, even billed calls never settle to the RevenueVault on-chain.

2. **Grow the node fleet beyond 1 and verify `/rpc/polygon` traffic serving**
   - `nodes_online: 1` today; more capacity = more throughput = more billing triggers.
   - Once Chainlist PR #8314 lands, capacity becomes the bottleneck.

3. **Wire API key provisioning into the post-deposit flow**
   - After a customer deposits, they need an API key immediately to use credits
   - `apps/web/src/app/satelink/os/deposit/page.tsx` should link or redirect to `/satelink/os/api-keys`
   - Or auto-create an API key on successful deposit confirmation
   - `apps/web/src/app/satelink/os/api-keys/page.tsx` already exists — wire it up

**Deposit flow:** ~~smoke-test e2e with real USDT~~ **DONE (SAT-240, 2026-06-05)** —
initiate → approve → deposit → credit → RPC billing all verified; DepositListener credits
within 1s, billing deducts 0.00001 USDT/call.

---

## SECTION 6 — AGENT EXECUTION RULES (mandatory)

- You have bash, git, curl access — USE THEM. Never write "I would do X" — DO X.
- Every task ends with production verification via curl, not just a commit.
- Deploy sequence: commit → `git push origin <branch>` → wait for Railway/Vercel → curl verify → DONE.
- GitHub token in `.mcp.json` — use it for branch/PR operations.
- If something is broken, fix it. Do not document broken things without also fixing them.
- All DB queries must use `await` — the async/sync bug kills revenue silently.
- Never hardcode secrets — use `process.env`, hard-fail if missing.
- `app_factory.mjs` is load-bearing: all /rpc, /api/keys, /credits routes live there.
  Before touching or deleting it, migrate ALL routes to server.js and verify with curl.

**Verification commands (run after every deploy):**
```bash
curl https://rpc.satelink.network/health
curl https://rpc.satelink.network/api/status
curl "https://rpc.satelink.network/credits/deposit/initiate?amount=1"
curl -o /dev/null -w "%{http_code}" https://app.satelink.network/satelink/os/deposit
```

---

## SECTION 7 — CURRENT OPEN WORK (from agent/memory/events/ACTIVE_EVENTS.md)

| Event | Severity | Status | Summary |
|-------|----------|--------|---------|
| EVT-REV-001 | REV-1 | NEW | Phase 0 gate open — collected-cash metrics not validated from live sources |
| EVT-OPS-001 | OPS-2 | ACTIVE | Local API unreachable — better-sqlite3 error chain; local dev broken |
| EVT-REV-002 | REV-2 | ACKED | USDT payment flow verification in progress (C4-1 legacy work) |
| EVT-CUST-001 | REV-2 | NEW | Customer Zero undefined — no retained paying machine or protocol customer yet |
| EVT-AUTO-001 | OPS-3 | NEW | Daily revenue-truth synthesis still manual; automation not built |
| EVT-ENG-002 | ENG-1 | NEW | P0 revenue blockers: (1) app_factory.mjs deletion would crash server — DO NOT commit any staged deletion of this file; (2) /credits/deposit/initiate needs end-to-end smoke test; (3) deposit frontend now exists at /satelink/os/deposit — needs wallet-connect wiring |

**Next priority:** EVT-CUST-001 — recruit Customer Zero by running the deposit flow on Polygon Mainnet.

---

## REPO STRUCTURE (actual paths, verified)

```
apps/api/                     Railway-deployed Node.js API (Express, port 8080)
  app_factory.mjs             LOAD-BEARING: all core routes mounted here
  server.js                   Entry point, imports createApp from app_factory.mjs
  src/workloads/rpc_gateway/  RPC execution + free-tier gate
  src/routes/credits.js       Billing: /credits/deposit/initiate handler
  src/economics/              Epoch scheduler, revenue distribution
  src/autonomous/             Sentinel, economy commander, auto-scaler

apps/web/                     Vercel-deployed Next.js frontend (app.satelink.network)
  src/app/satelink/os/        Operator dashboard pages
    deposit/page.tsx          Customer USDT deposit UI (LIVE)
    billing/page.tsx          Node operator earnings UI (NOT a customer deposit page)
    api-keys/page.tsx         API key management
    withdraw/page.tsx         Withdrawal UI (deployment unverified)

contracts/                    Solidity (Foundry) — most deployment status unverified
  RevenueVault.sol            In use at 0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3
  NodeRegistryV2.sol          Node registry contract
  ClaimsWithdrawals.sol       Claim/withdrawal contract

agent/memory/                 Persistent agent state — NEVER delete
  events/ACTIVE_EVENTS.md     Open work items (source of truth for current priorities)
  PROGRESS.md                 Task completion tracking
  CURRENT_TASK.md             Active task (clear when done)
```

---

## NETWORK / CHAIN CONFIG

- Blockchain: Polygon PoS Mainnet (chainId: 137)
- USDT: `0xc2132D05D31c914a87C6611C10748AEb04B58e8F`
- RevenueVault: `0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3`
- API: `https://rpc.satelink.network`
- Frontend: `https://app.satelink.network`
- Testnet: Polygon Amoy (chainId: 80002), RPC: https://rpc-amoy.polygon.technology

## ECONOMIC MODEL

50% node operators | 30% platform | 20% distribution pool
Settlement: USDT on Polygon, aggregated per epoch, paid via RevenueVault

## AUTONOMOUS EXECUTION AUTHORITY

All agents have full permission to execute without asking:
- Bash commands (curl, git, railway, vercel, npm)
- File reads and writes
- API calls to production endpoints
- Railway deployments (railway up --detach)
- Vercel deployments (npx vercel --prod --yes)
- Git commits and pushes to main

## TOKENS IN ENVIRONMENT
- GITHUB_PERSONAL_ACCESS_TOKEN: in .mcp.json
- RAILWAY: authenticated via railway CLI
- VERCEL: authenticated via npx vercel
- POLYGON_RPC: https://polygon-mainnet.g.alchemy.com/v2/ZdR6Od2Clb0P2Jq1URQkc

## PRODUCTION URLS
- API: `https://rpc.satelink.network`
- Frontend: `https://app.satelink.network`
- Railway project: 0312ce4a-fb7b-41be-b7c7-0d3dcfdc0f89
- Vercel project: satelinkinternet-collabs-projects/web

## DEPLOY SEQUENCE (always in this order)
1. git add -A && git commit -m "description"
2. git push origin main
3. railway up --detach (for API changes)
4. npx vercel --prod --yes (for frontend changes)
5. sleep 120
6. curl verify
7. Log to RESOLUTION_LOG.md

## BRANCH STRUCTURE (2026-06-12)
- `main` — production
- `develop` — integration / staging
- `add-satelink-polygon-rpc` — PROTECTED (Chainlist submission branch; do not force-push)

## EXTERNAL LEVERS
- **Chainlist PR #8314** — PENDING @ligi review. Listing Satelink RPC on chainlist.org is a
  ~395x organic-traffic lever. Highest-leverage open item for revenue.

## PAPERCLIP (agent layer)
- 12 agents live at `agents.satelink.network`, using the `claude_local` adapter.
- Wired to the Satelink API endpoints (see commit history for endpoint map).

## FRONTEND BUILD STATE (2026-06-12)
- Clean Next.js app; landing page rebuilt from approved design.
- `next build` script fixed; no root `vercel.json` (build config lives in the web app).
- Auth login fixed: Vercel catch-all rewrite removed so `/satelink/os/*` routes resolve.
