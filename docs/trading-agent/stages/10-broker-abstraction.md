# Stage 10 — Broker abstraction

- **Date:** 2026-09-30 (IST).
- **Branch:** `trading-agent/stage-10-broker-abstraction`, **stacked on** `trading-agent/stage-09-foundation` (PR #464, draft, unmerged; its evidence is `stages/09-foundation.md`). PR base = `trading-agent/stage-09-foundation`, so the diff shows Stage 10 only. When #464 merges into `trading-agent/integration`, retarget this PR to `trading-agent/integration`. Nothing reaches `main`.
- **Scope honoured:** changes only under `apps/api/src/trading_agent/brokers/**`, two new test files, and this doc. No DB, no API route, no existing code outside `trading_agent/`, no new dependency, no lockfile change.

## 0. STOP check: an existing abstraction that should be adapted instead?

Searched for adapter base classes and interfaces (`rg "class \w*(Adapter|Broker|Venue|Exchange|Provider)"`, `interface …`) and decimal libraries.

| Option | What exists | Fit for a broker/OMS abstraction | Verdict |
|---|---|---|---|
| **A. Adapt vNext kernel `WorkloadAdapter`** | `apps/api/src/vnext/kernel/interfaces.js:12-31`: `capabilities()`, `discover()`, `probe()`, `quote()`, `execute()`; `ExecutionSafety {IDEMPOTENT, AT_MOST_ONCE}`; `FeeAdapter.computeFee` returns `amount:number`. Reachable from the API but behind `VNEXT_KERNEL_ENABLED` (default OFF, `vnext/http/kernel_router.js:96`) | One-shot resale of a workload: no order lifecycle (ack → partial → fill → cancel), no query-by-client-id reconciliation, no ambiguous-outcome model, float amounts. Adapting it would squeeze an OMS into `execute()` and couple trading to a disabled kernel with its own "constitution" | **Not adapted.** Its `ExecutionSafety` concept is mirrored by name in `capabilities.mjs` (not imported) |
| B. `providers/adapters/BaseAdapter` | chain JSON-RPC validation/forwarding (`base_adapter.js`) | RPC transport only; **unreachable** from the deployed server (Stage 02 graph) | not applicable |
| C. `settlement/adapters/*` (`ISettlementAdapter`, EVM/Polygon/Fuse/NodeOps/…) | on-chain payouts | value transfer, not order management; mostly unreachable | not applicable |
| **D. New `BrokerAdapter` (built here)** | — | purpose-built: lifecycle, `SubmitOutcome`, reconciliation, capabilities with extensions, exact decimals | **Chosen** |

Decimal libraries in the lockfile (`decimal.js`, `big.js`, `bignumber.js`, `dinero`, `currency.js`): **none**. A small `BigInt`-based `decimal.mjs` was added instead (no dependency, no lockfile change), consistent with `libs/kernel` Money (bigint minor units).

→ **STOP not triggered.** Both options are reported above; the existing abstractions solve different problems.

## 1. What was built (`apps/api/src/trading_agent/brokers/`)

| File | Contents |
|---|---|
| `types.mjs` | `OrderSide`, `OrderType`, `TimeInForce`, `BrokerOrderStatus` (9 values incl. **`unknown`**), `TERMINAL_STATUSES`, `SubmitOutcome` (`placed`/`not_placed`/`unknown`), `Venue` (binance, upstox, alpaca, mock), `AssetClass` |
| `decimal.mjs` | exact decimal strings ↔ `{units: bigint, scale}`; `toMinor`/`fromMinor`; rounding `floor/ceil/half_up/half_even/exact`; `compare/add/mul`; `isMultipleOf`, `floorToStep`. **JS numbers are rejected** |
| `errors.mjs` | `BrokerError` (code, outcome, retryable, venue, venueCode, httpStatus); `ERROR_SEMANTICS`; `mapVenueError()` for transport, HTTP and Binance error codes |
| `status_map.mjs` | Binance / Alpaca / Upstox / Mock status tables → `BrokerOrderStatus`; unmapped → `unknown`; `refineByQuantity()` |
| `symbols.mjs` | canonical ids (`BTC-USDT`, `NSE:RELIANCE`), `defineInstrument` (tick, lot, min qty, min notional, quote decimals), `InstrumentRegistry` |
| `capabilities.mjs` | `defineCapabilities()` (asset classes, order types, TIF, client-id rules, partial fills, cancel, paper, static-IP need, `executionSafety`, declared `extensions`), `assertOrderSupported()` |
| `order_request.mjs` | `normalizeOrderRequest()` (field allowlist, lot/tick/min-qty/min-notional, notional in minor units rounded **up**), `assertNoSecrets()` |
| `fills.mjs` | `normalizeFill()` (fee → bigint minor units, exact), `aggregateFills()` (dedupe by fill id, exact notional, HALF_EVEN average price, fees per currency) |
| `adapter.mjs` | `BrokerAdapter`: public `placeOrder / cancelOrder / getOrder / listFills` validate then call protected `_…` hooks |
| `mock_broker.mjs` | deterministic `MockBroker` + `MOCK_CAPABILITIES`, `MockScenario` |
| `index.mjs`, `README.md` | exports + docs (`STATUS` stays `skeleton`: no live connector) |

### Error semantics (AMBIGUOUS → UNKNOWN)
| Code | Outcome | Retryable |
|---|---|---|
| INVALID_REQUEST, INSUFFICIENT_FUNDS, INSTRUMENT_NOT_TRADABLE, MARKET_CLOSED, AUTH_FAILED, PERMISSION_DENIED, REJECTED, ORDER_NOT_FOUND, INTERNAL | not_placed | no |
| DUPLICATE_CLIENT_ORDER_ID | not_placed (an earlier order may be live → reconcile) | no |
| RATE_LIMITED, TIMEOUT_BEFORE_ACCEPT, VENUE_UNAVAILABLE | not_placed | **yes** (same `clientOrderId`) |
| **AMBIGUOUS** | **unknown** | **no.** Reconcile via `getOrder({clientOrderId})` |

`mapVenueError`:
- request never sent → `VENUE_UNAVAILABLE`;
- sent, no response → `AMBIGUOUS`;
- HTTP 5xx → `AMBIGUOUS`;
- 429/418 → `RATE_LIMITED`;
- Binance `-1007` ("execution status unknown") → `AMBIGUOUS`;
- `-2010` / `-2011` classified by message.

### Status mapping (100% of entries tested)
| Normalized | Binance | Alpaca | Upstox |
|---|---|---|---|
| pending_new | pending_new | accepted, pending_new, accepted_for_bidding, held | put order req received, validation pending, open pending, after market order req received |
| acknowledged | new | new, done_for_day, pending_replace, stopped, suspended, calculated | open, trigger pending, modify pending, modify validation pending, modify after market order req received, modified, not modified, not cancelled |
| partially_filled | partially_filled | partially_filled | (via `refineByQuantity`: open + 0 < filled < qty) |
| filled | filled | filled | complete |
| pending_cancel | pending_cancel | pending_cancel | cancel pending |
| cancelled | canceled | canceled, replaced | cancelled, cancelled after market order |
| rejected | rejected | rejected | rejected |
| expired | expired, expired_in_match | expired | — |
| **unknown** | anything else | anything else | anything else |

Venue values follow each venue's public API documentation as known at authoring time. **They must be re-verified against live docs in each connector stage** (the tables are the single place to change).

### MockBroker scenarios
| Scenario | Result | Book after | Reconcile / retry behaviour (tested) |
|---|---|---|---|
| `ack` | PLACED, acknowledged | working | — |
| `partial` | PLACED, partially_filled (half, lot-floored) | working | `simulateFill` completes → filled |
| `fill` | PLACED, filled | filled | cancel → REJECTED |
| `reject` | throws REJECTED (not_placed) | absent | `getOrder` → ORDER_NOT_FOUND |
| `timeout_after_accept` | throws **AMBIGUOUS (unknown)** | **present, acknowledged** | `getOrder` finds it; resubmit → DUPLICATE_CLIENT_ORDER_ID (proves blind retry would double-order) |
| `timeout_before_accept` | throws TIMEOUT_BEFORE_ACCEPT (not_placed, retryable) | absent | same-id retry → PLACED |
| duplicate client id | throws DUPLICATE_CLIENT_ORDER_ID | original unchanged | — |

It's deterministic: injected clock, counter ids (`mock-ord-000001`, `mock-fill-000001`). Fees are `notional × feeBps / 10 000` in quote minor units (HALF_UP). Two identical runs are byte-identical (tested).

### Security: credential boundary (§10 of the brief)
- A `BrokerAdapter` **must** be constructed with a `credentialLoader.load(brokerAccountId)`. It is the only path to credentials. The handle is used internally and never returned or stored in results (tested: no handle text in any result or snapshot).
- Callers pass `brokerAccountId` matching `^bka_…$` (migration 021 ids). Credential-shaped values (e.g. an `sk_…` string, AWS key ids, objects) are rejected as INVALID_REQUEST.
- `assertNoSecrets()` rejects any request, order ref or adapter result extension containing keys like `secret`, `password`, `api_key`, `token`, `signature`, `private…`, `credential…`, `authorization` (recursive).
- Orders are scoped per broker account (another account's `getOrder` → ORDER_NOT_FOUND).

## 2. Test evidence

| Check | Command | Result |
|---|---|---|
| Stage 10 unit + scenario tests (+ Stage 09) | `cd apps/api && npx mocha --no-config --exit --require test/_guard/prod_db_guard.cjs test/trading_brokers_normalization.test.js test/trading_mock_broker.test.js test/trading_flags.test.js test/trading_foundation_schema.test.js` | **58 passing** (41 new in Stage 10 + 17 from Stage 09) |
| 100% of status mappings | the test holds **independent expected tables** for every venue; asserts equality with the source tables, maps every entry (plus an upper-case/whitespace variant) through `mapVenueStatus`, asserts unmapped → unknown and that every normalized status is reachable | ✅ |
| 100% of error semantics | every `BrokerErrorCode` outcome/retryable; every Binance table code; every `mapVenueError` branch | ✅ |
| API baseline guard (CI `baseline` job env) | `bash scripts/ci-baseline-check.sh` | **exit 0**: tests 563, passes 443, failures 2 (known), pending 118. Stage 09 was 522/402/2/118 → **+41 tests, +41 passes; unchanged pass rate** |

**Flaky test found (not introduced here):** `apps/api/test/identity_rate_limit.test.js` › "rotating random cookie values from one IP hits the per-IP ceiling (601st read → 429)" (from PR #456). It failed once in the first baseline run of this branch, **and once in 5 isolated runs with no Stage 10 code involved**; the baseline re-run passed. Outside this stage's allowed scope. It should be stabilized or added to the known-failures baseline in a separate PR.

## 3. Follow-ups for later stages
1. **OMS status vs broker status:** migration 021 `orders.status` CHECK has no `unknown`, `pending_new` or `pending_cancel`. The OMS stage must map broker statuses into order states (e.g. `pending_new` → `submitted`, `pending_cancel` → `cancel_requested`), and add an order state for **unknown / needs-reconciliation** via a new additive migration (022), not by editing 021.
2. Connector stages (Binance / Upstox / Alpaca) implement `_placeOrder` etc., build `InstrumentRegistry` from each venue's instrument master, re-verify the status and error tables, and run only inside the isolated execution service (08 §4) with a KMS-backed `credentialLoader` (06 §6).
3. Consider moving the pure modules (`types`, `decimal`, `errors`, `status_map`, `fills`) into `libs/agent-core` once a second deployable needs them (02 §6).

## Rollback
Revert or close this PR. It contains no schema change and no runtime wiring.
