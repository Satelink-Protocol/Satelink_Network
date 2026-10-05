# Alpaca Broker API connector (Stage 23)

Alpaca Broker API (correspondent model) behind the Stage 10 `BrokerAdapter` contract. State:
**IMPLEMENTED/TESTED only**:
- the `ALPACA` flag stays OFF, and nothing is mounted;
- sandbox only (production needs Alpaca's partner agreement, and is refused while `LIVE_TRADING` is locked).

| File | Purpose |
|---|---|
| `config.mjs` | sandbox / production hosts, client-id limit (48), commission types |
| `rest_client.mjs` | HTTP Basic with the correspondent key (injected); one request, no retry; failure classification |
| `commission.mjs` | commission instruction validation + hard caps; expected pro-rated commission per fill (cents, exact) |
| `mapping.mjs` | order body (with `commission` / `commission_type`), snapshots, SSE trade events, FILL activities, PII-free account summary |
| `sse.mjs` | SSE reader for `/v2/events/trades` (chunked, CRLF, comments surfaced) |
| `sim_book.mjs` | simulated double-entry commission book: **not the ledger** (Stage 20 stopped) |
| `adapter.mjs` | `AlpacaBrokerAdapter`: place / lookup by client_order_id / cancel / fills, `readAccount`, `streamTradeEvents` |

**Exactly-once:** Alpaca rejects a duplicate `client_order_id` (422) and supports lookup by it, so the
adapter is `IDEMPOTENT` and the Stage 17 OMS accepts it. A timeout becomes AMBIGUOUS, the order goes UNKNOWN,
and it is reconciled by client id, never resent.
