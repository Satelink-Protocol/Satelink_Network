# CURRENT STATE — Verified Ground Truth (2026-06-13)

This file supersedes stale status claims in CLAUDE.md, CURRENT_TASK.md, PROGRESS.md, REVENUE_LOG.md.
Every line is backed by the evidence files in this directory. Where this contradicts older docs, **this wins.**

---

## PRODUCTION SERVICES (smoke-tested)

| Service | State | Evidence |
|---|---|---|
| RPC gateway `/rpc/polygon` | ✅ LIVE | 200, block `0x5453abe` |
| `/health` | ✅ LIVE | `{"ok":true,"db":"ok"}` |
| `/api/status` | ✅ LIVE | epoch 4012, 25,936 req/24h, nodes_online:1 |
| `/credits/initiate` | ✅ LIVE | returns vault + USDT calldata |
| Paperclip agents | ✅ LIVE | agents.satelink.network → `{"status":"ok"}` |
| DepositListener | ✅ STARTED | server.js:441 |
| Settlement anchor | ✅ RUNNING, **never settles** | configured:true, processed:0, 4008 dust-skipped |
| Epoch scheduler | ✅ RUNNING | 60s epochs |
| On-chain settlement | ❌ ZERO | every epoch `txHash:null` |

## REAL REVENUE NUMBERS

- **Real external revenue: $0.** 0 customer deposits (no deposit can be confirmed; DepositListener has nothing to credit).
- **Recorded epoch "revenue" is phantom** — ~0.0025 USDT/epoch is the list-price of FREE traffic, not collected cash (see REVENUE_PATH_AUDIT). The credit gate IS wired (`rpc_gateway.js:175`) but only charges `x-wallet-address` requests; the 610k public calls bypass payment, and 0 wallets have deposited credits.
- 0 on-chain settlement transactions, ever.

## ACTIVE TRAFFIC / LEADS

- 1121 active IPs, 609,954 free-tier calls today. **Dominated by 2 scanner-class IPs (~361k calls, 59%).** Not developer demand.
- 66 "near-limit" IPs are the only realistic conversion cohort. 0 conversions.
- Upstash Redis is **at its 500k/day request cap** — free-tier `incr` traffic is exhausting it; gate degrades to unreliable in-memory counters.

## CORRECTIONS TO PRIOR DOCS (reality wins)

1. ❌ CLAUDE.md: "Settlement cannot submit — POLYGON_SIGNER_KEY missing." → ✅ **Signer IS configured** (`configured:true`). Real blocker = 1 USDT dust threshold + no dust-rollup code.
2. ❌ Brief: "445 active IPs." → ✅ **1121** active IPs.
3. ❌ Brief: "build artifacts committed to git." → ✅ **None**; `.gitignore` already comprehensive; no secrets in git.
4. ❌ Brief: table `billing_events.rpc_method`. → ✅ Actual table `revenue_events_v2`; `method` column existed but was never written (now fixed).
5. ⚠️ Brief: "$6.51/day Sonnet burn" → **unverified** (no billing-console access); model switch applied regardless as a safe optimization.

---

## FIX LIST

### P0 — blocks the first real dollar
- **Recruit/define Customer Zero + populate `credit_balances`** — the credit gate (`rpc_gateway.js:175`) is wired but only charges `x-wallet-address` requests, and `credit_balances` is empty (0 deposits). Every downstream revenue mechanism is untestable until one paying wallet exists. Note: the SDK/clients must actually send the `x-wallet-address` header or the charge path is skipped — verify the client emits it.
- **Decide settlement economics**: either lower `MIN_ANCHOR_REVENUE_USDT`, or implement the dust-epoch **rollup batch** the code comment promises but never built (`settlement_anchor_job.js:28-29`), or both. Then **fund the hot wallet** (USDT for transfers, MATIC for gas) or settlement still no-ops.

### P1 — operational reliability
- **Redis quota** (Upstash 500k/day exhausted): raise plan, or shed blocked-IP `incr` load (e.g., stop counting once an IP is already over-limit), or block abusive IPs upstream. Current degradation undermines rate limiting.
- **Resolve the 3 conflicting deploy configs** (root `railway.json` vs `apps/api/railway.json` vs `nixpacks.toml`) — pick one builder/start command.

### P2 — hygiene / cost
- **Model switch to Haiku** — ✅ DONE in this audit (`start-cloud.sh:47`); takes effect on next Paperclip rebuild.
- **Observability** — ✅ DONE: `revenue_events_v2` INSERT now records `chain, method, source` (`rpc_billing.js:73`).
- Prune 2.4 GB of stale `.claude/worktrees/` (local disk only — do manually, one may be in use).

## ESTIMATED TIME TO CUSTOMER ZERO

Not blocked by infrastructure — the deposit→credit→RPC plumbing exists end-to-end, the credit gate is wired, and the vault is live. Blocked by **(a)** the absence of any paying wallet (credit_balances empty) and **(b)** unverified whether clients send `x-wallet-address`. With one funded test wallet making a wallet-authenticated call, an end-to-end paid+settled call is achievable in **hours** (modulo lowering the 1 USDT anchor threshold so it actually settles). The durable demand lever remains Chainlist PR #8314 — but demand only converts to cash for wallet-authenticated, credited callers.

---

## SINGLE NEXT ACTION

**Run one wallet-authenticated paid call end-to-end:** deposit ≥1 USDT to the vault from a test wallet, confirm DepositListener credits `credit_balances`, then `POST /rpc/polygon` with `x-wallet-address: <wallet>` and verify a balance deduction (`credit_gate.js:62`) AND that the epoch crosses the anchor threshold to produce a real `tx_hash`. Evidence this is THE blocker: the gateway records `0.00003 USDT/call` into `revenue_events_v2` (`rpc_gateway.js:247/275`) for *everyone*, but deduction only happens for `x-wallet-address` requests with a funded `credit_balances` row (`credit_gate.js:44,62`) — of which there are currently zero. The system records revenue forever and collects nothing.
