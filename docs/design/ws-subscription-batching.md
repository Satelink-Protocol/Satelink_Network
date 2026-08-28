# Design: WS subscription batch billing (Phase 2) — NOT YET IMPLEMENTED (STOP-1)

## Problem
`ws_gateway.js` writes **1 revenue_events_v2 row + 2 ledger_entries rows per streamed
event** (`recordWsRevenue`, `WS_EVENT_PRICE_USDT = $0.000001`). PR #341 stopped the
*unauthenticated* storm by rejecting anonymous WS upgrades, but the **write amplification
is still in the design**: a single *authenticated, paying* client subscribing to Polygon
`newPendingTransactions` (thousands of events/sec) legitimately reproduces the storm —
100k+ money-path rows/hour from one client. The auth gate stopped the bleeding; it did
not fix the wound.

This is a design proposal only. **STOP-1: touching shared billing code needs approval.**

## Proposed design — windowed aggregation
Accumulate `ws_subscription` charges per `(principal_id, subscription_id, window)` and
write **ONE** revenue event + its balanced ledger txn per window (default 60s), carrying
`event_count` and `total_usdt` in the row (add columns via migration; `op_type` stays
`ws_subscription`).

```
per event:   INCR  ws:acc:{principal}:{sub}:{window_start}   (Redis, O(1), no PG row)
per window:  flush → one revenue_events_v2 row (amount = count × unit price, event_count)
                    → one balanced ledger txn (debit suspense / credit revenue), ONE PG txn
```

## Invariant analysis (2.3) — NO conflict found
- **Double-entry (inv #1) / append-only (inv #5):** unchanged. The *flush* writes a
  balanced draw + LedgerTransaction in a **single DB transaction**, exactly as today —
  just once per window instead of once per event. The per-event `INCR` is a pre-draw
  tally, not a ledger write, so no partial/unbalanced state ever exists in the ledger.
- **Draw + LedgerTransaction commit together (the standing rule):** preserved — the draw
  is created at flush time, atomically. Aggregation does **not** introduce eventual
  consistency into the ledger; it introduces a **bounded pre-ledger accumulation window**
  in Redis.
- The one new dependency: billing durability now leans on Redis for the ≤60s pre-flush
  tally. That is a deliberate, flagged trade — see the restart edge case.

Conclusion: batch aggregation is achievable without weakening any invariant. If a future
variant tried to write the ledger incrementally per event and "true up" later, THAT would
break append-only — do not do it.

## Edge cases (each needs a test before merge)
| case | behavior | test |
|---|---|---|
| client disconnects mid-window | flush the partial window on `close` (don't drop the tally) | open sub, stream N events, disconnect at N/2 → assert one flush of N/2 |
| process restart mid-window | Redis holds the tally; a startup sweep flushes any `ws:acc:*` keys whose window closed while the process was down. Unflushed charges are NOT silently lost | write tally, simulate restart (new instance), run sweep → assert the tally flushes exactly once |
| credits exhausted mid-window | check capacity at the window boundary; STOP streaming at the boundary (don't over-serve). The flush draws only what's authorized; excess is refused, subscription closed | set cap < window charge → flush draws to cap, `authorization`/`insufficient_capacity`, sub closed |
| clock skew / window-boundary double-count | window key is `floor(serverClockMs / windowMs)`; the flush is idempotent on `(principal, sub, window)` via the revenue `request_id = ws:{principal}:{sub}:{window}` (unique) — a double flush is a no-op | flush the same window twice → assert exactly one revenue row (unique request_id) |

## Rollout
Behind a `platform_flags` row `ws_billing_mode = per_event | windowed` (PR #329 pattern),
default `per_event` until the edge-case tests pass, then flip. No redeploy to revert.

## Status
Design only. Implementation is **STOP-1** (shared billing code). The migration adding
`event_count`/`total_usdt` and the Redis-sweep worker are not in this PR.
