# Stage 22 — Upstox COPILOT foundation

**Branch:** `trading-agent/stage-22-upstox`, stacked on Stage 21 (#476).

**State recorded: UPSTOX = IMPLEMENTED/TESTED** (COPILOT only):
- `UPSTOX_COPILOT` stays OFF, and the adapter refuses to construct without it;
- `UPSTOX_AUTOMATED` and `LIVE_TRADING` stay LOCKED;
- nothing is mounted.

**Code:** `apps/api/src/trading_agent/brokers/upstox/` (module table in its `README.md`).

**Tests:**
- `apps/api/test/trading_upstox_copilot.test.js`;
- the opt-in `apps/api/test/trading_upstox_sandbox.test.js`;
- `test/helpers/fake_upstox.mjs`;
- fixtures in `test/fixtures/upstox/` (from the documented payloads, user ids masked).

**DB:** none. **API:** internal.

**Upstox SDK:** not used. `upstox-js-sdk` is MIT-licensed (npm, 2.31.0), but a native client keeps the dependency set and lockfile unchanged.

## Inspection and STOP evaluation

> STOP if: any design requires sharing one static IP across customers.

**Not triggered: no design here shares one.** It is the binding constraint, though, so here is the evidence and the design response.

**U8, the static-IP model (verified 2026-10-05, Upstox developer docs):**

The rules:
- API order traffic must come from the user's registered static IP. This is enforced since 2026-04-01 under the SEBI / exchange retail-algo framework.
- It covers place, modify, cancel, multi-order, GTT and exit-all. Reads are not restricted.
- Each user registers **one primary and one optional secondary** IP, at user level (the same for every OAuth client).
- An IP can be changed **once per calendar week**, and a change **invalidates** the user's tokens.

The decisive sentence, from the algo-trading circular: *"A Static IP can be linked to only one customer … each Static IP is unique and cannot be shared or registered by any other customer."*

**Consequence:** a Satelink execution service placing orders for many customers from one egress IP would be exactly the forbidden design. So:
- **API placement** in production is allowed only from an egress IP that is dedicated to that customer, exclusive, and registered on **their** Upstox account. This is checked through `GET /v2/user/ip`.
- **Anything else resolves to PREPARE_ONLY:** no egress, a shared or non-exclusive egress, an IP assigned to someone else, or an IP not registered. `placeOrder` refuses, and `prepareOrder` returns a ticket the customer places themselves in the Upstox app.
- A property test checks that **no shared or non-exclusive combination ever resolves to API**.
- No per-customer egress exists today (B-08), so **production would run PREPARE_ONLY**.

**Sandbox (U6 equivalent), probed without a token on 2026-10-05:**

| Host / route | Result |
|---|---|
| `api-sandbox.upstox.com`: `/v3/order/place`, `/v3/order/modify`, `/v3/order/cancel`, `/v2/order/details`, `/v2/order/history` | **401** (route exists) |
| `api-sandbox.upstox.com`: `/v2/user/ip`, `/v2/user/kill-switch`, `/v2/feed/portfolio-stream-feed/authorize` | **404** (fixture-tested) |
| `sandbox.upstox.com` | NXDOMAIN (the host some pages mention doesn't resolve) |

The docs list place/modify/cancel (v2 and v3) as sandbox-enabled. Sandbox tokens come from the developer console (one sandbox app per user, valid 30 days) and work only for sandbox orders.

## Design

- **COPILOT confirmation:**
  - Every **place** and **modify** needs a confirmation from a **human**.
  - It must match the exact terms (a sha256 digest of account, client id, action, instrument, side, type, quantity, price and validity) and be at most 10 minutes old (one from the future is also refused).
  - It's looked up through a port (written by the approval UI, B-02) and is checked **before anything is sent**.
  - A confirmation for other terms, another account or the other action is refused, as is one by an agent or system.
  - Cancels need no confirmation: they reduce risk, and kill switches and revocations use them.
- **LIMIT only:**
  - Capabilities declare `orderTypes: [limit]`, so MARKET / SL / SL-M are refused by Satelink's normalizer before any call. `placeBody` refuses again.
  - Quantities must be whole shares.
  - Prices must survive Upstox's JSON-number format exactly.
  - Validity is DAY or IOC.
  - No `slice`, no AMO.
- **No `X-Algo-Name`:**
  - `config.algoHeaders()` is the only source, and it returns `{}` unless `UPSTOX_AUTOMATED` is enabled, which `flags.mjs` refuses for a locked flag.
  - A test sets `TRADING_FLAG_UPSTOX_AUTOMATED=true` and still gets `{}`.
  - A static test shows the header string appears in no other file.
- **OAuth, per user, encrypted:**
  - Authorization-code flow. `state` is HMAC-signed, expires in 10 minutes, and is bound to the principal and broker account, so it can't be replayed by another user or edited to another account.
  - The token is sealed straight into the vault; the caller gets metadata only.
  - **AES-256-GCM** with AAD = principal, broker account and expiry. An envelope copied to another user, or with an edited expiry, fails authentication.
  - Expiry is 03:30 IST the next morning (the documented rule, tested on the documented examples).
  - The keyring and client secret are injected: KMS in production (B-08).
  - The store is a port, and the in-memory store is test-only. **No Postgres table is written** (credential ciphertext writes stay blocked by B-08 / B-09).
- **Exactly-once:**
  - Upstox doesn't deduplicate `tag`, so the adapter declares `AT_MOST_ONCE`, and the Stage 17 OMS **refuses Upstox** (`VENUE_NOT_EXACTLY_ONCE`, tested).
  - That is consistent with COPILOT: a human confirms each order, and nothing is dispatched automatically.
  - One request per call, no retries. A mutating timeout is `AMBIGUOUS`, and the order is found again by `GET /v2/order/details?tag=` (tested).
- **Kill switch (`/v2/user/kill-switch`):**
  - `status` maps the documented shape.
  - `engage` refuses locally while positions are open (the venue's UDAPI1184 rule); nothing is closed automatically, because a human does that in COPILOT.
  - `release` is refused locally inside the **12-hour cooling** period, and the venue's UDAPI1185 maps to `REJECTED`.
  - Both report `tokenInvalidated` (Upstox requires a new token after a change).
  - **Mapping from Stage 15:** only a user's own account-wide stop (`principal` / `broker_account`) **proposes** a venue DISABLE. Global, venue, mandate, strategy and instrument stops are Satelink-only, so a platform stop never locks every customer's manual trading for 12 hours. A release never auto-enables the venue.
  - **Open question:** the docs name the action `ENABLE` / `DISABLE` (of the segment), with `kill_switch_enabled` in the response. The adapter treats DISABLE as engaging the kill switch. This should be confirmed against a real account before use.
- **Static IP read API:** `GET /v2/user/ip` only. Updating the IP (PUT) invalidates the user's tokens and belongs to the customer's own onboarding, so it is deliberately absent (static test).
- **Portfolio stream:**
  - `GET /v2/feed/portfolio-stream-feed/authorize?update_types=…` gives a one-time `wss` URL (single-use code), so every reconnect re-authorizes.
  - Order, position and holding messages are mapped (the documented examples are the fixtures). Orders are flagged ours or foreign by tag.
- **Tag length:** v3 allows 40 characters. The Stage 17 OMS uses 20 for Upstox, which fits both v2 and v3.

## Blocker impact

| Blocker | Touched? | Why the stage stays inside the accepted isolation |
|---|---|---|
| B-08 (KMS / isolated signer / static egress IP) | yes, **not resolved, and sharpened** | Upstox needs a static IP **per customer**, not one platform IP. B-08's "static egress IP" for Upstox means a dedicated, exclusive egress per customer (or customer-hosted execution). Until then production is PREPARE_ONLY. Tokens are sealed with an injected keyring (KMS = B-08); no ciphertext is persisted |
| B-09 (scope / legal) | yes, **not resolved** | broker-terms and SEBI retail-algo questions (are COPILOT orders "algo" orders? is Satelink an algo provider needing broker empanelment?) are open. Nothing is live, and `UPSTOX_AUTOMATED` stays locked |
| B-02 (no approval UI) | yes, **not resolved** | COPILOT confirmations come through a port that the approval UI would write; without it no confirmation exists, so no order can be placed |
| B-06 (no staging) | no | no migration, nothing deployed |
| others | no | not mounted; no infra, roles, CI or licence touched |

No blocker changes status. The Stage 22 row is added to the acceptance log in `docs/trading-agent/BLOCKERS.md`.

## Test evidence (2026-10-05)

| Suite | Result |
|---|---|
| `apps/api/test/trading_upstox_copilot.test.js` (mocha) | **29 passing** |
| `apps/api/test/trading_upstox_sandbox.test.js` (opt-in) | **pending**: no sandbox token in this environment (checked by name only) |
| All `trading_*` suites | **325 passing, 2 pending** (the Binance testnet and Upstox sandbox opt-ins) |
| Mutation checks (12) | all caught: agent may confirm, terms unchecked, confirmation never expires, MARKET body allowed, algo header ignoring the lock, shared IP allowed, no cooling check, positions unchecked, AAD not user-bound, OAuth state not user-bound, global stop disabling the venue, mutating timeout treated as not-sent |
| `scripts/ci-baseline-check.sh` | **832 tests / 710 pass / 2 known failures / 120 pending**, no new failures (+30 vs Stage 21) |

### Brief acceptance mapping

- **Sandbox place/cancel:** the full lifecycle on the fake venue: confirmed LIMIT → open (by tag) → partial (refined from quantities) → modify (re-confirmed) → fills from trades → cancel → second cancel refused. On the real sandbox it runs with the founder's token (below).
- **Confirmation required:** without one, nothing is sent. Agent, other-terms, other-account, other-action, stale and future confirmations are all refused.
- **Market orders rejected by Satelink:** MARKET / stop / stop-limit are refused before any call, even when "confirmed". `placeBody` refuses MARKET, and no file constructs `order_type: 'MARKET'` (static test).
- **Also covered:**
  - per-user tokens (another user can neither see nor cancel the order);
  - UDAPI and transport error mapping;
  - OAuth state tampering, expiry and foreign-user refusal;
  - vault AAD binding;
  - the placement policy property test;
  - prepare-order sends nothing and its ticket hash is deterministic;
  - every documented Upstox order status (17) maps.

### Running the sandbox acceptance (founder, local shell only, never committed)

```sh
cd apps/api
export UPSTOX_SANDBOX_ACCESS_TOKEN=…   # account.upstox.com/developer/apps → Sandbox app → Generate (30 days)
npx mocha --no-config --exit test/trading_upstox_sandbox.test.js
```

It places **one** confirmed LIMIT order (founder as the confirming human), records the status lookup (sandbox details support is undocumented), cancels it, and prints a one-line summary.

## Follow-ups (not in this stage)

- **Run the sandbox acceptance** with a founder sandbox token, and record the summary line here.
- **B-08 for India:** decide between a per-customer dedicated egress IP pool (provisioning, customer registers it, weekly-change and token-invalidation handling) and customer-hosted execution. Until then: PREPARE_ONLY.
- **B-09:** legal view on COPILOT under the SEBI retail-algo framework (algo-provider empanelment, the order-rate threshold) before any live use.
- **B-02:** the approval UI that writes confirmations (digest shown to the human), and the prepare-order ticket UI.
- **Confirm the kill-switch action semantics** (DISABLE = kill engaged) on a real account.
- **Instrument master** (Upstox instruments JSON → specs) and persisting the egress assignment.
- **Wire the portfolio stream** to Stage 18 fill ingest (re-authorize on every reconnect).

## Rollback

Revert the commit. There is no migration and no runtime wiring.
