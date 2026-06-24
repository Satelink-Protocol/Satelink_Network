# Phase 6 — Phantom Billing Elimination (Implementation Report, 2026-06-21)

Objective: only paid traffic creates revenue, so settlement anchors **collected**,
not notional, revenue. Status: **implemented, deployed (PR #171), live-verified.**

## 1. Revenue creation path (traced)

```
POST /rpc/:chain
  → authorizeAndMeter(api_credits)         ← deduction happens here (cost)
  → cache hit  → recordRpcRevenue(...)      ┐ RPC settlement revenue path
  → provider   → recordRpcRevenue(...)      │ (rpc_billing.js → revenue_events_v2)
  → network node → recordNodeSuccess(...)   ┘ (node_dispatcher.js → revenue_events_v2)
  → epoch aggregation → settlement rollup (sums revenue_events_v2)
```

## 2. Every `revenue_events_v2` writer (inventory)

| File | Scope | Phase 6 action |
|---|---|---|
| `workloads/rpc_gateway/rpc_billing.js` (`recordRpcRevenue`) | **RPC — settlement path** | **gated on real deduction** |
| `workloads/rpc_gateway/node_dispatcher.js` (`recordNodeSuccess`) | **RPC — node-served** | **gated on real deduction** |
| `workloads/mev_relay/index.js`, `ai_gateway/index.js`, `oracle/index.js`, `bandwidth_proxy/index.js`, `webhooks/index.js`, `rpc_gateway/ws_gateway.js`, `security/middleware/billing.js`, `core/operations_engine.js`, `queue/job_dispatcher.js`, `gateway/global/global_gateway_router.js` | separate workloads (AI/MEV/oracle/bandwidth/webhooks/ws/enterprise) | **out of scope** — not the RPC settlement path; flagged as follow-up (§6) |

Scope = the RPC revenue path that feeds epoch settlement (the audit's phantom
source). The other workloads are lower-volume distinct products; same pattern
should be applied to them next.

## 3. Enforcement built

Revenue event creation now requires **successful authorization + sufficient
credits + actual deduction**, threaded as `billedUsdt`:

- **`rpc_gateway.js`**: `billedUsdt = verdict.cost` only when canonical auth
  succeeded with cost > 0 (paid tier). Free tier cost 0; anonymous/legacy → 0.
  Passed to `recordRpcRevenue` and into `routeRpcRequest` (node path).
- **`recordRpcRevenue`**: returns `{recorded:false}` unless `amountUsdt > 0`;
  records the **actual deducted amount** (not chain list price) → ledger == credits.
- **`recordNodeSuccess`**: inserts revenue + broadcasts only when `billedUsdt > 0`;
  node stats (requests served, latency, reputation) still update for all traffic.
- 402 (insufficient credits) returns before billing — never records.

## 4. Before / After

```
BEFORE (phantom):
  ANY request (free / anonymous / paid)
      → recordRpcRevenue(list price)  → revenue_events_v2 row
      → epoch revenue = notional value of FREE traffic
      → settlement would anchor notional USDT

AFTER (collected-only):
  free / anonymous request → billedUsdt = 0 → NO revenue event
  exhausted account        → 402 (before billing) → NO revenue event
  paid request → authorizeAndMeter deducts cost → billedUsdt > 0
      → recordRpcRevenue(amount = deducted) → 1 revenue_events_v2 row
      → epoch revenue = Σ real deductions
      → settlement anchors COLLECTED USDT  (Σ revenue == Σ credits)
```

## 5. Verification evidence (live, prod, CREDIT_CANONICAL=true)

Unit (`test/rpc_billing_phase6.test.js`, 4 passing): skips amount 0 / missing /
negative / NaN; records the actual deducted amount when > 0.

Live (`scripts/cz_phase6_live.mjs`):

| traffic | requests | statuses | revenue events | usage rows |
|---|---|---|---|---|
| **free** | 3 | 200 200 200 | **0** | 3 (still metered) |
| **paid** | 5 | 200 200 200 **402 402** | **3** | 3 |

```
paid: balance 0.00009 → 0   deducted 0.00009   Σrevenue 0.00009
settlement_identity_holds: TRUE   (Σ revenue == collected credits)
revenue amount == actual deducted (not list price)
```

- ✅ free traffic creates 0 revenue events
- ✅ anonymous traffic creates 0 (same `billedUsdt=0` path as free; verified via free-key proxy)
- ✅ exhausted account → 402, no event
- ✅ paid traffic creates revenue events == deductions
- ✅ settlement totals == collected credits (no divergence — gate condition satisfied)

## 6. Caveats / follow-ups
- **Historical epochs remain phantom.** Epochs closed before this deploy still hold
  list-price revenue. Only epochs from now on are collected-only. If/when the
  rollup runs, consider excluding pre-Phase-6 epochs or flagging them.
- **Other workloads** (AI gateway, MEV, oracle, bandwidth, webhooks, ws, enterprise
  billing) still record unconditionally — apply the same `billedUsdt`-gating next.
- Settlement rollup remains flag-OFF + signer underfunded (Phase 5) — so no anchor
  fires yet; when it does, it will now anchor collected revenue.

## Rollback
`git revert` PR #171. The gating is self-contained in the RPC billing path; reverting
restores prior behavior (no schema change). `CREDIT_CANONICAL=false` also bypasses
the canonical deduction (legacy path), in which case `billedUsdt` stays 0 → still no
phantom events (anonymous/legacy already record nothing under the new guard).
