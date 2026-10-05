# Trading-agent Gate 0 blocker register

**Gate 0 status: NOT PASSED.** This register is the single source of truth for the Gate 0 blockers (B-01…B-12). They were first listed in the Stage 08 audit (§8.2, local audit commit `9b8eff69`).

**Last re-verified:** 2026-10-01, read-only, against `origin/main` @ `7fec0cba` (git reads plus one GitHub branch-protection read).

## Rules

1. **Accepted ≠ resolved.** The founder has *accepted* building Stages 09+ while these blockers are open, but only in isolation: code that is not mounted, has no public API, does not deploy, and makes no production security or infra change. That acceptance is recorded per stage below. It never changes a blocker's status.
2. **Allowed statuses:** `OPEN`, `PARTIAL` and `RESOLVED`. A blocker becomes `RESOLVED` only with resolution evidence (a merged PR, a commit, a verifiable setting, or a dated founder decision record) in its row. Nothing is marked resolved by inference or by the passage of time.
3. **A stage that needs a gated capability must STOP** and ask; it does not work around the blocker. See the "Gates" column and the capability map.
4. **Every stage doc from Stage 13 on must include a `## Blocker impact` section.** It lists which blockers the stage touches and why the stage stays inside the accepted isolation.
5. **`apps/api/test/trading_blocker_register.test.js` enforces rules 2 and 4** and the capability locks below. If this file drifts from the code, CI's baseline guard fails.
6. **Disclosure:** the repository is **public**. While a security blocker is open, this file names only its category. Route names, exploit paths and secret locations stay in the local, unpublished audit docs (`trading-agent/stage-06-security`, `…-08-deploy`). Add them here only after the fix ships.

## Register

| ID | Status | Category | Gates (what stays blocked while not RESOLVED) | Owner | Verification 2026-10-01 | Resolution evidence |
|---|---|---|---|---|---|---|
| B-01 | OPEN | Leaked credential in git history needs rotation (plus a check that an old fallback value isn't reused) | merge of trading code to `main`; trading use of any notification channel | founder | rotation can't be verified from code; needs founder confirmation | — |
| B-02 | OPEN | Web-tier staff/admin access control weakness; staff tokens need rotation after the fix | any trading admin/ops UI; **any human proposal-review/approval flow**; any staff-authorised action | founder + code stage | still present on `main` | — |
| B-03 | OPEN | Unauthenticated money-adjacent internal endpoints | merge of trading code to `main`; any trading integration with ledger, payables, epochs or withdrawals | code stage (founder approval) | still present on `main` | — |
| B-04 | OPEN | Dev-agent auto-approve in committed settings; Paperclip decommission; model-provider key rotation | deploying any agent runtime; giving any agent production credentials | founder | `autoApprove: true` still in committed `.claude/settings.json` on `main` | — |
| B-05 | OPEN | Public node-operator earnings claims need removal or rewording | any public trading UI, copy or marketing | founder | not re-checked (content); treated as open | — |
| B-06 | OPEN | No staging environment | merging `trading-agent/integration` → `main`; applying migrations 021–023 to any shared DB; any deploy | founder | no staging branch or env on origin | — |
| B-07 | PARTIAL | Migration tooling and schema drift | applying migrations to production; mapping trading fees into `revenue_events_v2` | founder | **Done:** canonical tool = `database/runner.ts` (founder decision, Stage 09). **Open:** read-only prod schema dump; `revenue_events_v2.amount_usdt` REAL vs NUMERIC | — |
| B-08 | OPEN | No KMS, no isolated execution/signer service, no static egress IP in a broker-permitted region; hot keys and platform tokens sit in the API env | any real broker adapter; storing credential ciphertexts; any signer; unlocking `LIVE_TRADING` / `UPSTOX_AUTOMATED` | founder | nothing provisioned | — |
| B-09 | OPEN | Scope (intelligence-only vs execution), brokers in scope, legal review of broker and market-data terms | any real broker or venue integration; market-data redistribution; unlocking `LIVE_TRADING` / `AUTONOMOUS_MODE` / `UPSTOX_AUTOMATED` | founder | no scope or legal decision recorded | — |
| B-10 | PARTIAL | CI and branch protection as a real gate | merging `trading-agent/integration` → `main` (CI can't be relied on as the gate) | founder (settings) + CI stage | **New since Stage 08:** `main` protection is on with 5 required checks. **Still open:** 3 of those checks run masked commands (`\| head` / `\| tail`, lint `continue-on-error`); integration suite non-blocking; `enforce_admins` off; no required PR review | — |
| B-11 | OPEN | Repo licence conflict (MIT `LICENSE` vs `LICENSE.BSL` BSL-1.1→AGPL) | public release or packaging of the trading module | founder | both files still on `main` | — |
| B-12 | RESOLVED | Non-production integration base branch | — | founder | `origin/trading-agent/integration` exists @ `7fec0cba` | Founder approved "Proceed, PR to integration" (Stage 09, 2026-09-30); branch created from `origin/main` `7fec0cba`; PR chain #464→#465→#466→#467 targets it, never `main` |

## Capability map (what the open blockers keep locked)

| Capability | Blocked by | Enforced by |
|---|---|---|
| Live (non-paper) orders: `LIVE_TRADING` | B-06, B-08, B-09 | `LOCKED_TRADING_FLAGS` in `trading_agent/flags.mjs`; register test |
| Agent acting without per-order approval: `AUTONOMOUS_MODE` | B-04, B-09 | same |
| Automated Upstox orders: `UPSTOX_AUTOMATED` | B-08, B-09 | same |
| Mounting any trading route or importing `trading_agent` from `app_factory.mjs` / `server.js` | B-03, B-06, B-10 | register test (static check) |
| Merging `trading-agent/integration` → `main` (= production deploy) | B-01, B-03, B-06, B-10 | process: every PR in the chain targets integration; founder merge only |
| Real broker adapters / credential ciphertext writes | B-08, B-09 | Stage 10 exposes only an injected credential loader; Stage 12 boundary lint. Stage 21's Binance adapter is testnet-only: it refuses to construct with the `BINANCE` flag OFF, refuses production while `LIVE_TRADING` is LOCKED, holds no credential material and writes no ciphertext (adapter tests) |
| Human approval UI for agent proposals | B-02 | not built; the proposal sink stays a port |

## Founder acceptance log (isolated build only; no status change)

| Stage | PR | Blockers touched | Why it stays isolated |
|---|---|---|---|
| 09 foundation + flags | #464 | B-06, B-07 | additive migration 021, applied only to local ephemeral DBs; flags default OFF; three flags hard-locked |
| 10 broker abstraction | #465 | B-08, B-09 | interfaces + mock broker only; no real adapter, no credential material |
| 11 market data | #466 | B-09, B-06 | public-endpoint provider injected, not wired; entitlements deny by default; no prod Redis |
| 12 agent tool layer | #467 | B-04, B-02 | propose-only tools; not mounted; the existing AI gateway is untouched; proposal review UI not built (B-02) |
| 13 strategy DSL | #469 | B-06, B-09, B-07 | pure validator/hasher/evaluator; no migration (uses 021 tables); not mounted; LIVE_SMALL/LIVE unreachable (LIVE_TRADING locked); no venue access |
| 14 backtest + paper | #470 | B-06, B-07, B-09 | additive migration 024 on local ephemeral DBs only; simulated book only (no broker, no orders/fills/positions/ledger writes); job runner not scheduled; market data only through the Stage 11 entitlement-checked port (internal_use) |
| 15 risk engine | #471 | B-06, B-07, B-02, B-08 | additive migration 025 on local ephemeral DBs only; pure checks + fail-closed wrapper; not mounted, nothing calls decide(); live and autonomous orders still impossible (LIVE_TRADING / AUTONOMOUS_MODE locked, check 3); admin role is asserted by the caller until staff auth exists (B-02) |
| 16 mandates | #472 | B-06, B-07, B-02, B-08 | additive migration 026 on local ephemeral DBs only; existing login flows untouched (TOTP adapter uses only getSession/verifyTOTP on an existing 2FA session); not mounted; mode C refused while AUTONOMOUS_MODE is locked; HMAC attestation key is injected (KMS = B-08); admin revoke is caller-asserted (B-02) |
| 17 OMS | #473 | B-06, B-07, B-08, B-09 | additive migration 027 on local ephemeral DBs only; no existing queue touched (reuses the 011 outbox pattern on trading_outbox); dispatcher and reconciler not scheduled; only MockBroker / test venues exist — no real broker adapter (B-08/B-09) |
| 18 portfolio + P&L | #474 | B-06, B-07, B-09 | additive migration 028 on local ephemeral DBs only; never writes the ledger (fills.ledger_txn_id NULL); not scheduled; broker positions only through an injected port (no real adapter); auto-pause uses the existing Stage 15 kill switch |
| 19 audit trail | #475 | B-06, B-07 | additive migration 029 on local ephemeral DBs only; append-only via triggers (no role changed — REVOKE stays inert under the prod superuser, B-07 / S-12 still open); no log format or OTel dependency added; not mounted |
| 21 Binance Spot adapter | #476 | B-08, B-09 | no migration; not mounted; `BINANCE` flag OFF; Spot Testnet only — production refused (`LIVE_TRADING` locked); credentials only via the injected loader (testnet keys in the founder's shell, never committed); key check refuses transfer/withdraw-enabled or non-IP-restricted keys; rebate sources read-only (Stage 20 stopped). Stage 20 revenue: STOPPED, no row |
| 22 Upstox COPILOT | #477 | B-08, B-09, B-02 | no migration; not mounted; `UPSTOX_COPILOT` flag OFF; sandbox only — production refused (`LIVE_TRADING` locked); `UPSTOX_AUTOMATED` locked so no `X-Algo-Name`; LIMIT only with per-order human confirmation (port, B-02); static IP is per customer at Upstox, so production resolves to prepare-order only until a dedicated per-customer egress exists (B-08); tokens sealed with an injected keyring, never persisted |
| 23 Alpaca Broker API | #478 | B-08, B-09 | no migration; not mounted; `ALPACA` flag OFF; sandbox only (self-serve; production needs Alpaca's partner agreement and is refused while `LIVE_TRADING` is locked); correspondent key injected (KMS = B-08), never stored; commission instructions capped; commission goes to a simulated book only — no ledger writes (Stage 20 stopped) |

## Open questions for the founder (no action taken)

- **B-01:** has the credential been rotated? If so, record the date here as resolution evidence.
- **B-10:** protection was turned on after the Stage 08 audit. Should the masked steps be unmasked (a CI-change stage, founder approval required) before the integration branch is proposed for `main`?
