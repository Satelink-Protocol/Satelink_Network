# Stage 24 — Trading agent API (/v1/trading) + MCP

**Branch:** `trading-agent/stage-24-api` (PR #479), stacked on Stage 23 (#478).

**State:** the API, the MCP endpoint and the OpenAPI file are **built and tested, but NOT registered** in `app_factory.mjs` (see "Registration" below).

**Code:** `apps/api/src/trading_agent/api/` (module table in its `README.md`), plus `mountTradingRoutes(app, { env, api })` in `trading_agent/index.mjs`.

**OpenAPI:** `docs/trading-agent/api/trading-v1.openapi.json` (3.1, 26 paths / 27 operations).

**Tests:** `apps/api/test/trading_api.test.js`.

**DB:** none.

## Inspection and STOP evaluation

> STOP if: route prefix collides with existing.

**Not triggered.**
- `app_factory.mjs` mounts several `/v1` routers before the `/v1` ai-gateway: deposit economics `/v1/credits` and `/v1/vault`; machine onboarding `/v1/pricing` and `/v1/machine/register`; `/v1/compare`, `/v1/capabilities`, `/v1/intelligence`, `/v1/plans`, `/v1/console/summary`, `/v1/me`, `/v1/tools`; and the ai-gateway's `/v1/models`, `/v1/ai/status`, `/v1/chat/completions` and `/v1/completions`.
- None defines `/trading`, and none has path-less middleware that would run on `/v1/trading` requests (all routers inspected).
- `/v1/trading` was reserved by Stage 09 (`TRADING_MOUNT_PATH`).
- The only other `/v1/trading` strings in the repo are **outbound** Alpaca Broker API URLs (Stage 23).
- The MCP endpoint is `/v1/trading/mcp`, a new route file inside the trading router. The existing `apps/mcp-server` (`/mcp`, `/execute`) is untouched.

**Audit 02 conventions applied** (route inventory and `/v1/me`, the session-authenticated account API):
- the Better Auth session through an injected resolver;
- a CSRF guard (custom header, trusted origin, JSON);
- idempotent mutations;
- `{ ok, data | error }` envelopes;
- routers mounted before the ai-gateway catch-all.

**"Document A Part J" was not available in the repo.** The endpoint set is derived from the services built in Stages 12–21, the same substitution Stage 12 recorded for Part E.

## Registration: not done (blocker register)

The brief's allowed paths include "route registration guarded by flag". The **blocker register** (`docs/trading-agent/BLOCKERS.md`, capability map) lists *"Mounting any trading route or importing `trading_agent` from `app_factory.mjs` / `server.js`"* as blocked by **B-03, B-06 and B-10**. A CI test enforces it statically.

At the time of writing:
- **B-03** (unauthenticated money-adjacent routes in the same app) is OPEN;
- **B-06** (no staging) is OPEN;
- **B-10** (CI) is PARTIAL.

Per the standing instruction (*"Do not silently treat them as solved. Continue building only where the stage is safely isolated"*), this stage:
- builds the API, the MCP endpoint and the OpenAPI file as isolated, flag-guarded modules;
- extends `mountTradingRoutes(app, { env, api })` so registration becomes **one line**;
- does **not** touch `app_factory.mjs`.

A test asserts `app_factory.mjs` and `server.js` still don't reference `trading_agent`. Registering is a founder decision. Either resolve B-03/B-06/B-10, or accept a recorded exception and change the register; then add the line in a separate change.

**Founder decision (2026-10-06): Option A, keep it unregistered.** The API stays out of `app_factory.mjs` / `server.js` until B-03, B-06 and B-10 are resolved. No exception was recorded, and the register and its CI test are unchanged.

## Design

**Flags.** `TRADING_AGENT` gates the whole router, and the check runs **per request**: flag off means every route is **404**, even unauthenticated, with the same body as an unknown path. `/mcp` additionally needs `MCP_TRADING`.

**Auth and tenant checks.**
- The principal comes only from the injected resolver: a Better Auth session (console) or an API key (agents and machines).
- A `principalId` in the body or query must match it (403 `TENANT_MISMATCH`).
- Ports call services with the authenticated principal and enforce ownership. A foreign resource is **404**, never 403, so existence doesn't leak.
- The router also hides any returned resource owned by someone else. This is defence in depth: a test uses a deliberately leaky port.
- The backtest port checks strategy-version ownership, which the Stage 14 job service doesn't do itself.

**CSRF.** Session mutations need `X-Satelink-Client: 1`, JSON, and a trusted `Origin` if one is sent. API-key callers don't need the header.

**Humans vs agents.** REST mutations are **human-only** (403 `HUMAN_REQUIRED`). Agents read via REST and act only through MCP, which can only read and propose.

**Idempotency-Key** is required on every REST mutation (8–128 of `[A-Za-z0-9_-]`).
- It is scoped to the principal and kept for 24 hours.
- The fingerprint is method + path + canonical body.
- Same key and request: the stored response is **replayed** (`Idempotent-Replayed: true`), errors included.
- Different request: **422** `IDEMPOTENCY_KEY_REUSED`.
- Still running: **409**.
- 5xx responses aren't stored, so a client can retry.
- `POST /orders` derives the OMS idempotency key from it, so a replay can never create a second order (tested: one OMS order).

**Step-up.**
- `POST /kill-switch/release` and `POST /proposals/:id/approve` verify `X-Satelink-Step-Up` through the Stage 16 verifier.
- `POST /mandates/:id/sign` **forwards** the code to the Stage 16 service, which verifies it with its reuse window and attempt limits. The route never verifies the same code twice (tested: the route's verifier is not called).
- Engaging a kill switch reduces risk, so it needs no step-up. Releasing one does.

**Rate limits.** Fixed one-minute windows per principal and class: read 120, write 30, step-up 5. Over the limit returns 429 with `Retry-After`.

**Orders.**
- `POST /orders` goes through Stage 17 acceptance (mandate + risk). A refusal returns 422 `REFUSED` with the reason.
- `POST /orders/:id/cancel` moves the order to `CANCEL_REQUESTED` through the Stage 17 `transition()`: a compare-and-set plus an `order_events` row with actor `user:<principal>`. The reconciler then cancels at the venue. Orders not yet at the venue return 409.

**Not built yet: 501, never guessed data.**
- `GET /orders` (no OMS listing by principal yet);
- `/proposals*` (the review queue is B-02).

**MCP:**
- JSON-RPC 2.0: `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`; batches of up to 20.
- The tools are the Stage 12 `ToolRegistry`, so there are only READ and CONTROLLED (propose) tiers. Execution names (place / submit / cancel / modify order, withdraw, transfer, credentials, `execute_*`) cannot be registered and are refused when called. A tier filter applies again in the handler.
- The registry factory receives only the authenticated principal. `mcp.mjs` imports no OMS, services or brokers (static test).
- Proposals are pending-review data, not orders (tested: zero OMS orders after `propose_order`).

**Errors.** Domain code maps to HTTP status. Unknown errors become 500 `INTERNAL` with a generic message. Malformed JSON returns a 400 envelope, never an HTML stack page.

## Blocker impact

| Blocker | Touched? | Why the stage stays inside the accepted isolation |
|---|---|---|
| B-03 (unauthenticated money-adjacent routes) | yes, **not resolved** | the trading API is not mounted next to them; registration is left to the founder |
| B-06 (no staging) | yes, **not resolved** | nothing is deployed or registered; no migration |
| B-10 (CI) | yes, **partial** | the register's static mount check still passes and is re-asserted by this stage's tests |
| B-02 (no approval UI) | yes, **not resolved** | the proposal review endpoints return 501 until the review queue exists |
| others | no | |

No blocker changes status. The Stage 24 row is added to the acceptance log in `docs/trading-agent/BLOCKERS.md`.

## Test evidence (2026-10-06)

| Suite | Result |
|---|---|
| `apps/api/test/trading_api.test.js` (mocha) | **22 passing** |
| All `trading_*` suites (including the Stage 09 flag tests and the Stage 12 boundary lint) | **361 passing, 3 pending** (the three opt-in live tests) |
| Mutation checks (15) | all caught: flag gate open, body tenant check removed, router ownership check removed (survived at first, so the leaky-port test was added), no replay, fingerprint ignoring the body, key not principal-scoped, Idempotency-Key optional, step-up not verified, agents allowed to mutate, no CSRF header, no rate limit, backtest ownership skipped, MCP flag gate removed, MCP bypassing the registry, sign verifying the code twice |
| `scripts/ci-baseline-check.sh` | clean runs: **869 tests / 746 pass / 2 known failures / 121 pending** (+22). **Flakiness, reported honestly:** 2 of 4 full runs failed `identity_rate_limit` cases (timing-sensitive). That suite passes 17/17 alone ×3, sorts before any `trading_*` file, and Stage 24 changes no file it loads. It is the same recurring flakiness noted since Stage 12 |

### Brief acceptance mapping

- **Flag off ⇒ routes 404:**
  - with `TRADING_AGENT` off, `mountTradingRoutes` mounts nothing;
  - a mounted router whose flag is turned off answers 404 for **every** route in `ROUTES`, even unauthenticated;
  - `/mcp` is 404 while `MCP_TRADING` is off.
- **Contract tests:**
  - the route table and the OpenAPI document match in both directions;
  - every mutation declares the required `Idempotency-Key`, and every step-up route declares `X-Satelink-Step-Up`;
  - every observed response status is documented for its operation;
  - envelopes are consistent.
- **MCP cannot place orders:**
  - `tools/list` contains READ / CONTROLLED tools only;
  - `place_order`, `submit_order`, `cancel_order`, `modify_order`, `execute_trade` and `withdraw_funds` are all refused;
  - such tools can't even be defined;
  - `propose_order` creates a proposal and **no order**.
- **Idempotent replays:** replay of the same request; 422 on a different request; per-principal scoping; one OMS order per key; an invalid or missing key refused before any work.

## Follow-ups (not in this stage)

- **Registration (decided 2026-10-06: wait).** Add `mountTradingRoutes(app, { env, api })` to `app_factory.mjs`, before the `/v1` ai-gateway, only after B-03, B-06 and B-10 are resolved.
- **Durable idempotency store:** a Postgres-backed one; this stage adds no table.
- **Order listing** by principal (an OMS read model).
- **The proposal review queue and approval UI (B-02).** `approve` should run Stage 17 acceptance with `origin: 'agent'`, `approvedBy` set to the human, after step-up.
- **The `resolvePrincipal` composition:** Better Auth session → principal (the console accounts table maps to `principals`), and API key → agent principal.

## Rollback

Flag off (`TRADING_AGENT`), which turns every route into a 404. Or revert the commit; nothing is registered or migrated.
