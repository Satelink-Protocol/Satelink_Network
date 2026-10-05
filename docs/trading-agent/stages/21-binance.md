# Stage 21 — Native Binance Spot adapter

**Branch:** `trading-agent/stage-21-binance` (PR #476), stacked on Stage 19 (#475). Stage 20 (revenue) is STOPPED awaiting a founder decision and has no branch.

**State recorded: BINANCE = IMPLEMENTED/TESTED only.**
- The `BINANCE` flag stays OFF; the adapter refuses to construct without it.
- Nothing is mounted.
- Production is refused while `LIVE_TRADING` is LOCKED.

**Code:** `apps/api/src/trading_agent/brokers/binance/` (module table in its `README.md`).

**Tests:**
- `apps/api/test/trading_binance_adapter.test.js`;
- the opt-in `apps/api/test/trading_binance_testnet.test.js`;
- helpers `test/helpers/fake_binance.mjs` and `test/helpers/binance_lifecycle.mjs`;
- sanitized fixtures in `test/fixtures/binance/`.

**DB:** none (no migration). **API:** none.

## Inspection and STOP evaluation

> STOP if: any production Binance key is needed; testnet unreachable; CCXT prefix cannot be overridden.

**Not triggered.** In detail:

- **Production keys:** none needed and none used.
  - The adapter targets the Spot Testnet.
  - `resolveEnvironment('production')` throws `PERMISSION_DENIED` unless `LIVE_TRADING` is enabled, which `isTradingFlagEnabled` refuses for a LOCKED flag whatever the environment says.
  - A test asserts this with `TRADING_FLAG_LIVE_TRADING=true`.
- **Testnet reachable** (U6, below).
- **CCXT prefix can be overridden** (U13, below). CCXT is still not used: the adapter is native (no new dependency, no lockfile change).

### U6 — which Binance test environment (verified 2026-10-05)

| Environment | Endpoint | Result |
|---|---|---|
| Spot Testnet REST | `https://testnet.binance.vision` | 200 (`exchangeInfo`, `ticker/price`; re-checked during this stage: BTCUSDT tick 0.01, step 0.00001, min notional 5) |
| Spot Testnet WS API | `wss://ws-api.testnet.binance.vision/ws-api/v3` | documented endpoint, used by the adapter |
| Demo trading REST | `https://demo-api.binance.com` | 200 |

**Answer:** the Spot Testnet. It has an independent key system (no production account involved) and the same REST and WS API surface.

`/sapi` does **not** exist there. This affects:
- key validation (`/sapi/v1/account/apiRestrictions`);
- rebates (`/sapi/v1/broker/rebate/*`).

Both are covered by fixture contract tests, per the brief.

**Live filter found by probing testnet:** `PERCENT_PRICE_BY_SIDE bidMultiplierDown 0.5`, measured against the 5-minute average. The acceptance order therefore bids at **0.6 ×** the last price: never marketable, and clear of the 0.5 boundary.

### U13 — can the CCXT Binance `x-` prefix be overridden?

**Yes.** In CCXT `ts/src/binance.ts`:
- `generateClientOrderId` returns `brokerId + uuid22()`, with `brokerId = safeString(options.broker, type, default)`.
- The defaults are spot `x-TKT5PX2F`, swap/future `x-cvBPrNm9`, and delivery/option `x-xcKtGhcu`.
- `createOrderRequest` uses the generated id **only when no `clientOrderId` is passed**. Otherwise it sends `newClientOrderId = clientOrderId` verbatim.

So CCXT could carry our Link ID. The native adapter makes the question moot: it always sends `x-<LinkID>` + the OMS id.

## Design

- **Client ids:**
  - `newClientOrderId = "x-<LinkID>" + <OMS client id>`.
  - Capabilities declare `clientOrderIdMaxLength = 36 − len(prefix)`, so the Stage 17 generator (`min(36, caps, 32)`) always fits.
  - For every Link ID length from 4 to 16, the sent id is **exactly 36** characters (tested).
  - Ids are translated back on every read; foreign ids (web, other apps) are reported `ours: false`.
- **Exactly-once:**
  - Binance refuses a duplicate id only while that order is OPEN (`-2010 Duplicate order sent.`); a filled id can be reused.
  - The adapter therefore declares `IDEMPOTENT`, but Stage 17's rules are what make it safe: reconcile from **history** (`GET /api/v3/order?origClientOrderId=`), and never resend `UNKNOWN` blind.
  - The REST client sends **one** request per call and never retries.
  - A mutating timeout or dropped connection is `AMBIGUOUS`. A refused connection, or any failure of a read, is `VENUE_UNAVAILABLE`.
  - 5xx responses are `AMBIGUOUS`.
- **Symbols:** Binance order queries need a symbol. It is kept from `placeOrder`, or resolved through an injected `orderDirectory.instrumentFor(account, clientOrderId)` after a restart. Without one, the lookup is refused, never guessed.
- **Key validation:**
  - **Refused** if any of `enableWithdrawals`, `enableInternalTransfer` or `permitsUniversalTransfer` is true, or if `ipRestrict` is false.
  - **Required:** `enableSpotAndMarginTrading` and `enableReading`.
  - A missing field counts as unsafe.
  - Enforced before the first order wherever `/sapi` exists, then cached for an hour. `enforceKeyRestrictions` lets the fixture tests exercise the refusal path, because production is locked.
- **Signing and secrets:**
  - HMAC-SHA256 (hex) and **Ed25519** (base64).
  - Ed25519 keys are parsed and type-checked (an RSA PEM is refused).
  - Secrets reach the adapter only through the Stage 10 `CredentialLoader` handle: KMS in production (B-08), local env in dev via the test harness.
  - No file under `binance/` reads `process.env`, logs, or returns a secret (static test).
- **User data:**
  - WebSocket API only. Ed25519 uses `session.logon` then `userDataStream.subscribe` (no params); HMAC uses `userDataStream.subscribe.signature`.
  - `userDataStream.unsubscribe` runs on close.
  - **No listenKey** anywhere (static test, plus the REST call log of the fake venue).
  - `executionReport` maps to status, cumulative filled quantity, reject reason and a normalised fill (trade id, last qty/price, exact commission). A cancel's own id is in `C`.
- **Market data:** unchanged. The Stage 11 `binance_public_provider` remains the market-data path. `exchangeInfo` maps to instrument specs for the order path only.
- **Rebates (read-only):**
  - `ExchangeLinkRebateSource` calls `GET /sapi/v1/broker/rebate/recentRecord` with a window under 7 days and page size ≤ 500. It returns exact decimal amounts, with status 0/1/2 mapped to pending/settled/failed.
  - `LinkAndTradeRebateSource` is an explicit placeholder: `available: false`, and it throws.
  - **Nothing is posted to any ledger:** Stage 20 stays stopped.

## Blocker impact

| Blocker | Touched? | Why the stage stays inside the accepted isolation |
|---|---|---|
| B-08 (KMS / isolated signer / static IP) | yes, **not resolved** | the adapter is a real venue connector, which the register lists as blocked by B-08 for production use. It holds no credential material (injected loader only), writes no ciphertext, and production is unreachable (`LIVE_TRADING` locked). Testnet keys stay in the founder's local shell. `requiresStaticIp` is declared for production and the key check refuses non-IP-restricted keys, so B-08's static egress IP is a hard prerequisite, not bypassed |
| B-09 (scope / legal) | yes, **not resolved** | code exists, but no production integration, no Link ID registration, no market-data redistribution. Using Binance for real customers still needs the scope and legal decision |
| B-06 (no staging) | no | no migration, nothing deployed |
| B-01–B-05, B-07, B-10, B-11 | no | not mounted; no infra, roles, CI or licence touched |

No blocker changes status.
- The Stage 21 row is added to the acceptance log in `docs/trading-agent/BLOCKERS.md`.
- The capability-map row for real broker adapters now records how the Binance adapter is fenced.

## Test evidence (2026-10-05)

| Suite | Result |
|---|---|
| `apps/api/test/trading_binance_adapter.test.js` (mocha) | **24 passing** |
| `apps/api/test/trading_binance_testnet.test.js` (opt-in) | **pending**: no TESTNET keys in this environment (checked by name only). Runs with the founder's keys, see below |
| All `trading_*` suites | **296 passing, 1 pending** |
| Mutation checks (8) | all caught: dropped transfer check, no Link prefix, caps ignoring the prefix, mutating timeout treated as not-sent, cancel id read from `c` only, Ed25519 using the HMAC subscribe, key check skipped, float average price (the last one survived at first, so an exact-average test was added) |
| `scripts/ci-baseline-check.sh` (CI's dummy `DATABASE_URL`) | **802 tests / 681 pass / 2 known failures / 119 pending**, "no new failures outside the known baseline" (+25 vs Stage 19: 24 tests + 1 pending) |

### Brief acceptance mapping

- **Permission rejection.**
  - Each forbidden permission and a missing IP restriction are refused, field by field.
  - With enforcement on, a withdrawal-enabled key is refused **before any POST** reaches the venue.
  - A good key trades, and the check is cached.
- **Link ID prefix and length.**
  - The prefix is `x-<LinkID>`, with the Link ID validated (4–16 alphanumerics).
  - 36 characters are accepted and 37 refused; the charset is enforced.
  - The OMS id plus the prefix is exactly 36 for all Link ID lengths.
- **Timeout → UNKNOWN → reconciled.**
  - The fake venue accepts the order, then the POST times out (real `AbortController` path).
  - The OMS records `UNKNOWN`; the dispatcher refuses to resend.
  - The reconciler queries by `origClientOrderId`, and the order goes to `ACK`.
  - **One** venue order, **one** POST.
- **WS executionReport mapping.** Sanitized fixtures cover:
  - NEW, partial TRADE and final TRADE (fills with exact fees);
  - CANCELED (our id in `C`);
  - REJECTED (reason kept);
  - a foreign order (`ours: false`);
  - a non-execution event (ignored).
- **WebSocket flows.** Both Ed25519 and HMAC are covered against a fake WS API, which verifies the signatures.
- **Testnet order lifecycle in the audit trace.**
  - The same `runLimitLifecycle` helper powers the unit test (fake venue) and the testnet test.
  - Steps: LIMIT BUY at 0.6 × last price → OMS accept → dispatch (`ACK`) → `CANCEL_REQUESTED` → reconciler `DELETE` → `CANCELLED`, all under one W3C trace.
  - The result is a **complete** Stage 19 receipt: risk, mandate hash, dispatch, fills = 0, trace consistent, ledger "not posted".
  - On the fake venue this passes. On the real testnet it needs the founder's keys.

### Running the testnet acceptance (founder, local shell only, never committed)

```sh
cd apps/api
export BINANCE_TESTNET_API_KEY=…            # from testnet.binance.vision (GitHub login)
export BINANCE_TESTNET_API_SECRET=…         # HMAC key, or instead:
# export BINANCE_TESTNET_ED25519_KEY_PATH=~/keys/binance-testnet-ed25519.pem
export BINANCE_TESTNET_TRACE_OUT=/tmp/binance-testnet-receipt.json   # optional
npx mocha --no-config --exit test/trading_binance_testnet.test.js
```

It places and cancels **one** LIMIT order, prints a one-line summary (venue client id, order id, states, traceparent, receipt hash) and optionally writes the redacted receipt.

## Follow-ups (not in this stage)

- **Run the testnet acceptance** with founder-supplied TESTNET keys, and record the summary line here.
- **B-08:** KMS-backed `CredentialLoader`, an isolated execution service, and a static egress IP registered on the key. Then run `validateKey` against production `/sapi` as part of onboarding.
- **B-09:** a Binance Link / broker agreement and Link ID registration (which programme: Exchange Link or Link-and-Trade decides which rebate source is real).
- **Persist `instrument`** on the OMS row lookup path (`orderDirectory` backed by `orders.instrument`) when the dispatcher is composed for real.
- **Wire the user-data stream** to `applyBrokerSnapshot` and the Stage 18 fill ingest (reconnect and resubscribe policy, gap fill via `myTrades`).
- **Rebate booking** waits on the Stage 20 decision (U2 and the ledger kinds).

## Rollback

Revert the commit. There is no migration and no runtime wiring, so nothing else changes.
