# Stage 23 — Alpaca Broker API foundation

**Branch:** `trading-agent/stage-23-alpaca`, stacked on Stage 22 (#477).

**State recorded: ALPACA = IMPLEMENTED/TESTED only:**
- the `ALPACA` flag stays OFF, and the adapter refuses to construct without it;
- nothing is mounted;
- sandbox only.

**Code:** `apps/api/src/trading_agent/brokers/alpaca/` (module table in its `README.md`).

**Tests:**
- `apps/api/test/trading_alpaca_broker.test.js`;
- the opt-in `apps/api/test/trading_alpaca_sandbox.test.js`;
- `test/helpers/fake_alpaca.mjs`.

**DB:** none. **API:** none.

## Inspection and STOP evaluation

> STOP if: sandbox access requires a signed agreement not yet in place.

**Not triggered.**
- **Sandbox access is self-serve:** free email signup at `broker-app.alpaca.markets/sign-up` gives sandbox API keys and test data immediately.
- **The partner agreement and business documents** (incorporation certificate, tax id) are needed only **to go live**.
- **Sandbox host:** `https://broker-api.sandbox.alpaca.markets`. It answers 401 without credentials on `/v1/accounts`, `/v2/events/trades` and `/v1/trading/accounts/{id}/orders:by_client_order_id`, so the routes exist (probed 2026-10-05).
- **Production** (`broker-api.alpaca.markets`) is refused while `LIVE_TRADING` is locked.

**Dependency on Stage 20:** the brief lists Stage 20, which is **STOPPED** (U2 = PARTIAL; new `ledger_txns.kind` values unapproved). This stage does **not** need it: the commission mapping goes to a **simulated book** (`sim_book.mjs`) that imports no ledger, billing, settlement or revenue code (static test). Booking real commission revenue waits on the Stage 20 decision.

## Design

- **Correspondent model:**
  - Alpaca Broker API uses one firm key (HTTP Basic `key:secret`), injected through the Stage 10 `CredentialLoader` (KMS in production, B-08).
  - End-user accounts are addressed by Alpaca account UUID through an injected directory. There are no per-user secrets.
- **Commission on every order:**
  - An injected policy (pricing, Phase 12) returns `{amount, type}`. It is validated against **hard caps**: notional ≤ $50, qty ≤ $0.05/share, bps ≤ 100. Notional is in dollars (≤ 2 dp), and anything invalid never reaches the venue.
  - `commission` and `commission_type` (`notional` default, `qty`, `bps`) are sent in the order body.
  - Alpaca echoes them, and snapshots report them.
- **Commission semantics (Alpaca Broker API trading docs):**
  - `notional`: per order;
  - `qty`: per share, pro-rated;
  - `bps`: of the order's notional;
  - **pro-rated on each execution** whatever the type;
  - on a sell, capped at the principal (net of SEC/TAF).
- **Expected commission per fill** (`expectedCommissionByFill`):
  - Exact in cents, half-even.
  - For per-order amounts it is computed from the cumulative share, so the fills sum exactly to the total ($1 over 1/1/1 shares gives 33 + 34 + 33).
  - It is Satelink's **estimate**. When Alpaca's reported figure is known it wins, and the variance is kept.
- **Simulated book:**
  - Each commission becomes a balanced pair: debit `sim:customer:<account>:cash`, credit `sim:correspondent:commission_revenue`.
  - Entries are idempotent by fill id and marked `simulated: true`.
- **Exactly-once:**
  - `client_order_id` ≤ 48 (the Broker API reference; the Trading API allows 128). Alpaca rejects a duplicate with **422 "client_order_id must be unique"**, which maps to `DUPLICATE_CLIENT_ORDER_ID`.
  - `GET /v1/trading/accounts/{id}/orders:by_client_order_id` looks an order up by it.
  - So the adapter is `IDEMPOTENT`, and the Stage 17 OMS accepts it. A **timeout is AMBIGUOUS**: the OMS records `UNKNOWN`, never resends, and the reconciler finds the order by `client_order_id`, leaving **one** venue order (tested).
  - One request per call, no retries.
- **Accounts (read):**
  - `readAccount` returns status, type, currency, crypto status, created-at and last equity.
  - **Identity and contact PII are dropped** inside the adapter (tested against a fixture that contains them).
- **Trade events:**
  - SSE from `GET /v2/events/trades` (v1 is deprecated). The stream is firm-wide, and there is no history unless `since` or `since_id` is given, so consumers resume from the last durably processed `event_id` (lexically sortable ULID).
  - The parser handles chunk splits, CRLF and multi-line data, and surfaces `:` comment lines (slow-client notices).
  - `fill` / `partial_fill` events become normalised fills (execution id, price, qty, timestamp).
- **Fills (REST):**
  - `GET /v1/accounts/activities/FILL?account_id=…`, filtered by order id.
  - The activity schema comes from Alpaca's activities documentation and is **not yet sandbox-verified**.

## Blocker impact

| Blocker | Touched? | Why the stage stays inside the accepted isolation |
|---|---|---|
| B-08 (KMS / isolated signer) | yes, **not resolved** | the correspondent key is a firm-wide credential (higher value than a per-user key): KMS-only in production. Here it is injected; nothing is stored |
| B-09 (scope / legal) | yes, **not resolved** | going live needs Alpaca's partner agreement and business documents, and charging commissions is a regulated revenue path (Phase 12 pricing). Nothing is live, and the commission caps are placeholders for the pricing decision |
| B-06 (no staging) | no | no migration, nothing deployed |
| Stage 20 (revenue) | dependency **not met**, worked around | simulated book only; no ledger writes |
| others | no | not mounted |

No blocker changes status. The Stage 23 row is added to the acceptance log in `docs/trading-agent/BLOCKERS.md`.

## Test evidence (2026-10-05)

| Suite | Result |
|---|---|
| `apps/api/test/trading_alpaca_broker.test.js` (mocha) | **14 passing** |
| `apps/api/test/trading_alpaca_sandbox.test.js` (opt-in) | **pending**: no sandbox credentials in this environment (checked by name only) |
| All `trading_*` suites | **339 passing, 3 pending** (the Binance, Upstox and Alpaca opt-ins) |
| Mutation checks (11) | all caught: commission dropped from the body, no cap, notional proration off by a cent, bps scale ×10, no sell cap, sim book not idempotent, reported figure ignored, PII leaking from `readAccount`, mutating timeout treated as not-sent, wrong client-id lookup, SSE comments dropped |
| `scripts/ci-baseline-check.sh` | **847 tests / 724 pass / 2 known failures / 121 pending**, no new failures (+15 vs Stage 22) |

### Brief acceptance mapping

- **Commission fields present:**
  - each of `notional`, `qty` and `bps` is sent in the POST body, echoed, and reported back on lookup;
  - out-of-cap, malformed or unknown-type instructions never reach the venue;
  - no policy means no commission fields.
- **Timeout handling:**
  - A POST that times out after Alpaca accepted it goes to `UNKNOWN` in the OMS, and the dispatcher refuses to resend.
  - The reconciler finds it by `client_order_id`, and it ends `ACK` with **one** venue order and **one** POST.
  - Refused connection maps to `VENUE_UNAVAILABLE` and a 5xx to `AMBIGUOUS`, each with one POST.
- **Reconciliation by `client_order_id`:** lookups use the by-client-id route with the exact id. A duplicate submit is refused by the venue rule.
- **SSE trade events:** chunked stream to events to fills, then into the simulated book (a $1 notional commission over fills of 3 and 7 shares gives 30 + 70 cents, balanced).

### Running the sandbox acceptance (founder, local shell only, never committed)

```sh
cd apps/api
export ALPACA_SANDBOX_API_KEY=… ALPACA_SANDBOX_API_SECRET=…   # broker-app.alpaca.markets (free sandbox signup)
export ALPACA_SANDBOX_ACCOUNT_ID=…                            # a sandbox customer account UUID
npx mocha --no-config --exit test/trading_alpaca_sandbox.test.js
```

It places one far-from-market LIMIT order (AAPL @ $1.00, with a $0.01 notional commission), reads it back by client id, cancels it, and prints a one-line summary.

## Follow-ups (not in this stage)

- **Run the sandbox acceptance** with founder sandbox credentials, and record the summary line here. Also verify the FILL activity schema and how commission is reported per execution (activity type), then set `reportedCents` from it.
- **Stage 20 decision:** move from the simulated book to real commission revenue entries (new ledger kinds) only after U2 is resolved and the kinds are approved.
- **Pricing (Phase 12 / B-09):** the real commission policy and caps.
- **Durable SSE cursor:** persist the last processed `event_id` and feed fills into Stage 18 ingest.

## Rollback

Revert the commit. There is no migration and no runtime wiring.
