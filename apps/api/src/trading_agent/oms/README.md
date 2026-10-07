# trading_agent/oms

**Status:** Stage 17 order management system. `STATUS = 'skeleton'` = not wired: no routes, and nothing runs the dispatcher or reconciler.

**Responsibility:** exactly-once order *intent*. An order the risk engine and a signed mandate approved reaches the broker at most once, and its state always comes from the venue. There are no blind resends.

**Tables:** `orders` + `order_events` (021, + 027 columns and transition trigger), and `trading_outbox` (021) as the transactional outbox / queue.

| Module | Purpose |
|---|---|
| `states.mjs` | NEW → SENT → ACK → PARTIAL → FILLED / CANCELLED / REJECTED / UNKNOWN (+ CANCEL_REQUESTED from Stage 16). Edge table, broker-status map, forward-only rank |
| `client_order_id.mjs` | deterministic client order id per order, within venue limits (Binance 36, Upstox 20, Alpaca 48, mock 64) |
| `acceptance.mjs` | mandate (Stage 16) + recorded risk APPROVE (Stage 15) + exactly-once-capable venue, then **one transaction** writing order + event + outbox |
| `dispatcher.mjs` | the **only** `adapter.placeOrder` caller. Write-ahead SENT; reconcile before any resend; one call per attempt; timeouts → UNKNOWN |
| `reconciler.mjs` | resolves SENT / UNKNOWN / ACK / PARTIAL / CANCEL_REQUESTED from venue **history** by client id; grace window before "absent"; sends cancels for CANCEL_REQUESTED |
| `transitions.mjs` | compare-and-set state changes (status + send generation) + `order_events`, idempotent snapshot application |
| `store.mjs` | `InMemoryOmsStore` (atomic transactions), `PgOmsStore` (`FOR UPDATE SKIP LOCKED` claim with a lease) |

**Adapter contract** (for the future real adapters): the venue must be `IDEMPOTENT`, support client order ids, and support query by client order id. **Its HTTP / SDK client must not auto-retry order POSTs**; the dispatcher owns every retry decision.
