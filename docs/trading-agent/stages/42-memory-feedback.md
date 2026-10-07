# Stage 42 — Trading memory + feedback / calibration (Phase 6 item 9)

## Inspection (reuse before build)

| Existing | Where | Used how |
|---|---|---|
| decisions with dimension scores | `trading_decisions` (033), `decision/` (item 6) | `decision_memory` references them; feedback reads the stored dimension scores |
| strategy versions (append-only, hash-bound evidence, no update path) | `strategies/service.mjs`, `lifecycle.mjs` (Stage 13) | revisions = `createVersion` → DRAFT; the lifecycle guards force re-validation |
| append-only guard | migration 029 | all memory tables except the profile |
| step-up verifier | `authorization/step_up.mjs` (Stage 16) | calibration approval (same contract as admin step-up, Stage 28) |

## Test evidence (2026-10-07)

| Suite | Result |
|---|---|
| `apps/api/test/trading_memory.test.js` | **13 passing**: profile versioning; decision → authorization → outcome, one outcome only; **bounded structured retrieval** (25-row cap, exact fixed-point net P&L, no secret context or chat fields, deterministic summary); feedback: < 30 labels → no proposal; flat / not_executed / WAIT excluded; a predictive dimension (out_of_sample 80 vs 40) gains weight in a pending `scorecard/1.1` whose weights sum to 100 **while the live config stays 1.0**; no signal → no proposal; approval refused for agents / platform (even with a staff id), non-staff and failed step-up; staff approval returns a frozen 1.1 config the scorecard accepts; decided once; stale proposal → CONFLICT; rejection applies nothing; **revision = v2 in DRAFT, v1 untouched (deep-equal) and still PAPER, v2 cannot skip BACKTESTED or reuse v1's evidence; no update/edit method exists; identical revision → NO_CHANGE** |
| `database/__tests__/trading-memory.integration.test.ts` (local Postgres) | **4 passing**: profile version bump; 40 persisted decisions + outcomes; second outcome refused by the unique index; append-only; **Postgres and in-memory context summaries identical**; proposal persisted, single human decision, `scorecard/1.1`; down migration keeps 033 |
| All trading integration suites | **17 files, 64 passing** (034 added to the foundation / audit / decisions down-chains) |
| Mutation checks (10) | all caught: non-labels counted, tiny samples propose, agents may approve (survived at first → a test where everyone is "staff" was added), non-staff may approve, step-up ignored, stale proposal applied, weights not summing to 100, unbounded retrieval, no-op revision accepted, second outcome accepted |

A real bug fixed while testing: the context summary's outcome order depended on row order (different between stores) — now canonical.

## Blocker impact

| Blocker | Touched? | Why the stage stays inside the accepted isolation |
|---|---|---|
| B-03 / B-06 / B-10 | yes (migration 034) | not mounted; 034 applied only to local ephemeral databases |
| B-07 (roles) | yes | additive; append-only via the 029 guard + REVOKE from `satelink_app` |
| B-02 (staff approval) | yes | calibration approval requires a server-verified staff check + step-up; still unmounted |
