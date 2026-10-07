# Stage 39 — Scorecard + hard gates + GO / WAIT / REJECT (Phase 6 item 6)

## Inspection (reuse before build)

| Existing | Where | Used how |
|---|---|---|
| 20 ordered, fail-closed pre-trade checks | `risk/evaluate.mjs`, `risk/checks.mjs` (Stage 15) | **the risk gate is `evaluateChecks` itself**, unchanged; any non-APPROVE → `risk:<check id>` |
| kill-switch resolution | `risk/kill_switch.mjs` `activeKillSwitchesFor` | the explicit kill-switch gate (fails closed if state unknown) |
| mandate (status, `validUntil`) | the risk context's mandate (Stage 16 shape) | the mandate gate reads the SAME object as the risk engine |
| backtest / walk-forward / stress / regime / liquidity / data confidence | items 4–5, Stage 14 | dimension inputs and gate inputs; their hashes become `evidence_refs` |
| append-only guard | migration 029 `trading_append_only_guard()` | reused for `trading_decisions` (033) |
| canonical hashing | `strategies/canonical.mjs` | `input_hash` (clock excluded) |

## Design

See `apps/api/src/trading_agent/decision/README.md`. Thresholds: GO needs score ≥ 65 and confidence ≥ 60; decisions expire after 15 min, or earlier at the mandate's or the validation evidence's expiry. **The score is decision quality, NOT a probability of profit** — stated in config, output (`scoreMeaning`), explanation and docs.

## Test evidence (2026-10-07)

| Suite | Result |
|---|---|
| `apps/api/test/trading_scorecard.test.js` | **25 passing**: config (10 weights = 100, frozen); healthy real-engine input → GO 88 / confidence 95 with the documented shape; "not a probability of profit"; **12 single-gate failures each REJECT** (policy kill switch via risk engine, kill-switch event, stale / missing data, broker degraded, insufficient liquidity, abnormal spread, mandate expired / revoked, validation expired / missing, no order); **property: with every threshold at 0, any single failed gate still REJECTs and all 8 gate families are exercised**; risk gate = Stage 15 (order over caps); WAIT on score and on confidence; missing inputs → null, exact score, −10 confidence; expiry = min(TTL, mandate, validation); determinism + clock-independent input hash; bounded dimensions; persisted with `explanation_ref`; store failure → REJECT `record_failed` |
| `database/__tests__/trading-decisions.integration.test.ts` (local Postgres) | **4 passing**: GO + REJECT persisted with scores / gates / explanation; constraints (REJECT ⇔ failed gates); append-only for every role, `satelink_app` has no UPDATE; down migration |
| All trading integration suites | **15 files, 59 passing** (033 added to the foundation and audit down-chains — it depends on 029's guard) |
| Full API suite | 1016 passing / 20 failing on the confirming run, the baseline set exactly. A first run also showed `catalog_consistency` (8/8 alone ×2) and the known `identity_rate_limit` load flake |
| Mutation checks (13) | all caught: high score overrides a gate, confidence ignored, risk engine ignored, kill-switch / broker / abnormal-spread gates dropped, revoked mandate accepted, stale validation accepted, missing dimension counted neutral (survived at first → exact-score assertion added), missing inputs don't lower confidence, TTL widened, unrecorded GO returned, expiry ignores the mandate |

## Blocker impact

| Blocker | Touched? | Why the stage stays inside the accepted isolation |
|---|---|---|
| B-03 / B-06 / B-10 | yes (migration 033) | not mounted; 033 applied only to local ephemeral databases |
| B-07 (roles) | yes | 033 is additive; append-only via the 029 guard + REVOKE from `satelink_app` (tested) |
| B-09 (scope / legal) | yes | decisions are internal; nothing is shown to users; the "not a probability of profit" statement is built in for later UI copy |
