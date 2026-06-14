# REVENUE PATH AUDIT — Forensic Trace

**Date:** 2026-06-13. Every step cites file:line and/or live runtime evidence.

## THE HEADLINE FINDING

**Recorded epoch "revenue" is phantom.** Free-tier RPC calls are recorded at the list price (0.00003 USDT/call) into `revenue_events_v2` and aggregated into epochs as `total_revenue_usdt`, but **no USDT is ever collected**. The credit gate IS in the `/rpc/:chain` chain — but it only charges requests carrying an `x-wallet-address` header; the dominant public/unauthenticated traffic bypasses payment entirely and is still billed at list price. There are no deposits, so even wallet-authenticated callers would hit the insufficient-credits 402. The epoch revenue figure is the *notional value of free traffic*, not cash. This is the root reason "real external revenue = $0" persists despite epochs showing non-zero revenue.

---

## STEP-BY-STEP STATUS MAP

| Step | Status | Evidence |
|---|---|---|
| `rpc_entry` | ✅ verified | `app_factory.mjs:325` — `app.use("/rpc", freeTierGate, express.json(), createRpcGateway(pool))`. Live: `POST /rpc/polygon` → 200, block `0x5453abe`. |
| `free_tier_gate` | ✅ verified | `free_tier_gate.js:58-142`. 500 calls/day/IP via Redis `ft:<ip>` incr (`:76`). Live counters: 1121 active IPs. |
| `402_response` | ✅ verified (code) / ⚠️ not live-triggered | `free_tier_gate.js:109-135` returns machine-readable `payment{vault_address, token_address, chain_id:137, deposit_url}`. Fires only at `count > 500` (`:96`). Production `conversion_targets` show IPs with `exceeded:true` → threshold logic works. Over-limit *test* (1 spoofed call) returned 200 because a fresh IP is under 500 — test premise flawed, not a defect. |
| `credit_gate` | ⚠️ wired, but public traffic bypasses | `createCreditGate` (`credit_gate.js:11`) IS in the chain — `rpc_gateway.js:42` creates it, `:175` `router.post('/:chain', creditGate, handler)`. **But** `credit_gate.js:44-45` (`if (!rawWallet) return next()`) means it only deducts for requests with an `x-wallet-address` header. The 610k public calls carry no wallet header → pass through uncharged. With 0 deposits, any wallet-authenticated call would hit the insufficient-credits 402 (`:90`). Net: **no pay-per-call revenue is collected.** |
| `billing_events` | ⚠️ phantom | `rpc_billing.js:73-77` `recordRpcRevenue` fires **unconditionally** on every served call (`rpc_gateway.js:247` cache hit, `:275` provider). Inserts `amount_usdt = 0.00003` with no payment check. Table is `revenue_events_v2` (NOT `billing_events`). |
| `epoch_creation` | ✅ verified | `epoch_scheduler.js` started `server.js:431`. Live: `current_epoch:4012`, 60-second epochs (settlement history: `startedAt`→`closedAt` = 60000ms). ~1440 epochs/day. |
| `settlement_anchor` | ✅ running, ⚠️ never settles | `server.js:487` starts it (10min). `settlement_anchor_job.js`. Live: `started:true, configured:true, last_result:{processed:0, skipped_below_threshold:4008}`. |
| `on_chain_tx` | ❌ **ZERO** | `/api/settlement/history`: every epoch `txHash:null, merkleRoot:null`. 0 on-chain settlements ever. |

---

## WHY SETTLEMENT NEVER FIRES (corrects CLAUDE.md)

CLAUDE.md Section 4 claims the blocker is **"POLYGON_SIGNER_KEY missing."** **This is wrong.**

- `settlement_anchor_job.js:48-53` sets `configured=true` **only when `POLYGON_RPC_URL && POLYGON_SIGNER_KEY && POLYGON_USDT_ADDRESS` are all present.** The live endpoint reports `configured:true` → **the signer IS set in Railway.**
- The real gate is `settlement_anchor_job.js:100`: `AND e.total_revenue_usdt >= $1` where `$1 = MIN_ANCHOR_REVENUE_USDT = 1.0` (`:30`). Each epoch is **~0.0025 USDT** (settlement history: `totalRevenue:"0.00246000"`). So **all 4008 closed epochs sit below the 1 USDT threshold** as "dust" and never anchor.
- The code comment (`:28-29`) claims dust epochs "stay unanchored until rolled into a future batch with real revenue" — **but no such rollup code exists.** The job processes epochs individually (`:94-103`); dust is never aggregated. At current per-epoch revenue, settlement is mathematically impossible.
- Even if an epoch crossed 1 USDT: the on-chain path (`:178-216`) requires the hot wallet to **hold USDT** (`balanceOf` check `:184-185`) or fall back to a **0-value MATIC anchor tx** (needs MATIC for gas). Settlement also depends on funding the hot wallet — unverified.

---

## SUPPORTING SERVICES

- **DepositListener** — ✅ started (`server.js:441`, `deposit_listener.js`). Credits wallets on on-chain USDT deposit. Cannot be exercised without a real deposit (none exist).
- **Method observability gap** — `recordRpcRevenue` received `method`/`chain`/`source` but the original INSERT wrote none of them (only `op_type='rpc_call'`). The alternate node path `recordNodeSuccess` (`node_dispatcher.js:233`) encodes method into `op_type` as `rpc_${method}` but also skips the dedicated `method` column. **Fixed in this audit** (see COST_ANALYSIS / commit): INSERT now writes `chain, method, source`.

## VERDICT

The revenue *plumbing* runs end-to-end (entry → gate → billing → epoch → anchor). But it monetizes nothing: billing records list-price on free traffic, the credit gate only charges `x-wallet-address` requests (of which there are effectively none, and 0 have credits), and settlement is permanently dust-gated. **First real dollar requires: (1) a paying wallet that deposits USDT (credit_balances populated), (2) callers actually sending `x-wallet-address`, (3) an epoch that crosses the 1 USDT anchor threshold (or a dust-rollup batch), (4) a funded hot wallet for the settlement tx.**
