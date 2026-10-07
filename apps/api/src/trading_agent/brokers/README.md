# trading_agent/brokers

**Status:** Stage 10 has added the broker abstraction. There is **no live venue connector** (and no network code) yet.

**Responsibility:** Broker account registry and venue connectors (Binance, Upstox, Alpaca), behind one venue-agnostic contract. Real connectors will run only in the isolated execution service with static egress (audit/08 §4).

**Table** (migration 021): `broker_accounts`. **Flags** (default OFF): `BINANCE`, `UPSTOX_COPILOT`, `UPSTOX_AUTOMATED` (locked), `ALPACA`.

## Modules
| File | Purpose |
|---|---|
| `types.mjs` | Frozen enums: `OrderSide`, `OrderType`, `TimeInForce`, `BrokerOrderStatus` (includes `UNKNOWN`), `SubmitOutcome` (`placed` / `not_placed` / `unknown`), `Venue`, `AssetClass` |
| `decimal.mjs` | Exact decimal-string / bigint arithmetic (no floats; JS numbers are rejected): parse/format, `toMinor`/`fromMinor`, rounding modes, `isMultipleOf`, `floorToStep` |
| `errors.mjs` | `BrokerError` + `ERROR_SEMANTICS` (code → outcome + retryable). `AMBIGUOUS` → outcome `UNKNOWN`. `mapVenueError()` for network/HTTP/Binance codes |
| `status_map.mjs` | Venue status tables (Binance, Alpaca, Upstox, Mock) → `BrokerOrderStatus`; unmapped → `UNKNOWN`; `refineByQuantity()` (Upstox partial fills stay "open") |
| `symbols.mjs` | Canonical ids (`BTC-USDT`, `NSE:RELIANCE`), `defineInstrument`, `InstrumentRegistry` (venue symbols are looked up, never parsed) |
| `capabilities.mjs` | `defineCapabilities()` descriptor, `ExecutionSafety`, `assertOrderSupported()`; venue features are preserved as declared `extensions` |
| `order_request.mjs` | `normalizeOrderRequest()` (allowlisted fields, lot/tick/min-notional checks, notional in minor units rounded **up**), `assertNoSecrets()` |
| `fills.mjs` | `normalizeFill()` (fee as bigint minor units), `aggregateFills()` (dedupes redelivered fills, exact notional, HALF_EVEN average price, fees per currency) |
| `adapter.mjs` | `BrokerAdapter` base: `placeOrder` / `cancelOrder` / `getOrder` / `listFills` validate, then call `_…` hooks. Credentials come **only** from the injected `credentialLoader` |
| `mock_broker.mjs` | Deterministic `MockBroker` with scenarios `ack`, `partial`, `fill`, `reject`, `timeout_after_accept`, `timeout_before_accept`, plus duplicate-client-id detection |

## Retry rules (the reason `SubmitOutcome` exists)
- `NOT_PLACED` + `retryable` (`TIMEOUT_BEFORE_ACCEPT`, `RATE_LIMITED`, `VENUE_UNAVAILABLE`) → retry with the **same** `clientOrderId`.
- `UNKNOWN` (`AMBIGUOUS`) → **reconcile first** with `getOrder({clientOrderId})`. Never blind-retry.
- `DUPLICATE_CLIENT_ORDER_ID` → this submit wasn't placed, but an earlier one may be live, so reconcile.

## Rules
- Money is `NUMERIC` minor units + currency + decimals; quantities and prices are decimal strings. Never JS floats.
- Callers pass `brokerAccountId` (`bka_…`), never secrets. Requests or refs with secret-looking keys are rejected.
- LLM output is data (signals/proposals), never a command.
