# SATELINK AGENT BRAIN — MASTER CONTEXT
# Last updated: 2026-06-04 (verified by curl + code audit)
# Every agent reads this FIRST. No exceptions.

---

## SECTION 1 — WHAT SATELINK IS

Satelink is a DePIN RPC gateway on Polygon: machines pay USDT to call blockchain APIs
(eth_getBalance, eth_call, etc.) routed through a permissionless node network.
Revenue target is $500/hr in collected USDT on-chain; current collected revenue is ~$0.36/hr
with zero customer deposits confirmed as of 2026-06-04.

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

## SECTION 3 — WHAT IS LIVE AND WORKING (curl-verified 2026-06-04)

| Endpoint | Status | Notes |
|----------|--------|-------|
| `GET https://rpc.satelink.network/health` | LIVE | `{"ok":true,"server":"ok","db":"ok"}` |
| `GET https://rpc.satelink.network/api/status` | LIVE | operational, 79,812 req/24h, epoch 13303 |
| `GET https://rpc.satelink.network/stats/free-tier` | LIVE | `{"activeIPs":0,"totalCalls":0,"limit":500}` |
| `GET https://rpc.satelink.network/credits/deposit/initiate?amount=1` | LIVE | Returns ABI calldata, vault addr, gas estimates |
| `GET https://rpc.satelink.network/credits/initiate?amount=1` | LIVE | Same handler, both URL variants work |
| `GET https://app.satelink.network/satelink/os/deposit` | LIVE | Deposit page renders (HTTP 200) |
| `apps/web/src/app/satelink/os/deposit/page.tsx` | LIVE | Customer USDT deposit UI with copy-calldata + step instructions |
| RevenueVault on Polygon | CONFIGURED | Fallback: 0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3, also env var |
| Epoch scheduler | RUNNING | Current epoch: 13303 |
| WebSocket gateway | MOUNTED | `/ws/stats` endpoint active |

---

## SECTION 4 — WHAT IS BROKEN OR INCOMPLETE (verified 2026-06-04)

### CRITICAL: Zero nodes online
- `nodes_online: 0` from `/api/status`
- `activeIPs: 0, totalCalls: 0` from `/stats/free-tier`
- The RPC gateway is live but no nodes are registered and serving traffic
- Without nodes: no real RPC execution, no billing triggers, no revenue

### UNVERIFIED: Node registration end-to-end
- Route: `app_factory.mjs:263` → `app.use("/api/nodes", createNodeRegistryRouter(pool, redis))`
- Curl to `/v1/nodes/register` and `/api/keys` returns HTML (auth-gated — untested with valid token)
- No confirmed test of: register node → get approved → serve traffic → earn reward

### UNVERIFIED: Withdrawal/claim flow
- `ClaimsWithdrawals.sol` exists in contracts/ but no deployment record found
- `apps/web/src/app/satelink/os/withdraw/page.tsx` exists
- End-to-end (earn → claim → withdraw USDT) not confirmed working

### UNVERIFIED: RevenueVault contract deployment
- API uses `0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3` as vault address
- No deployment script output or deployment manifest found in repo
- Polygonscan: https://polygonscan.com/address/0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3
- Verify this contract accepts deposits before directing customer funds to it

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

**Single biggest reason for $0 customer deposits:**
Zero nodes are online. The RPC gateway has no capacity — a customer who deposits USDT
has nothing to use it for. No nodes = no value delivered = no reason to pay.

**3 fixes most likely to bring the first deposit:**

1. **Register at least 1 node and verify it serves `/rpc/polygon` traffic**
   - Even a single VPS running the node daemon routes real calls
   - Once traffic flows, billing triggers, and there is proof-of-value for customers
   - Start by curl-testing `/api/nodes/register` with a valid auth token

2. **Smoke-test the complete deposit flow end-to-end with real USDT**
   - `GET /credits/deposit/initiate?amount=5` → get calldata
   - Submit approve + deposit txns on Polygon Mainnet with a real wallet
   - Confirm credit balance appears in the API
   - Confirm a follow-up RPC call deducts credits correctly
   - Without this test, we don't know if money is actually collectible

3. **Wire API key provisioning into the post-deposit flow**
   - After a customer deposits, they need an API key immediately to use credits
   - `apps/web/src/app/satelink/os/deposit/page.tsx` should link or redirect to `/satelink/os/api-keys`
   - Or auto-create an API key on successful deposit confirmation
   - `apps/web/src/app/satelink/os/api-keys/page.tsx` already exists — wire it up

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
