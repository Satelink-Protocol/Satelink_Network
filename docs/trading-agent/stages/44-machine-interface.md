# Stage 44 — Machine + AI-agent interface (Phase 6 item 11)

## Inspection (reuse before build)

| Existing | Where | Used how |
|---|---|---|
| `/v1/trading` router, envelope, idempotency, rate limiter, OpenAPI contract | `api/` (Stage 24) | three routes added (contract test passes both ways); idempotency reused |
| `principals` with kinds `agent` / `machine` and `parent_id` | migration 001 | agent / machine principals owned by a human — no new identity system |
| key hashing scheme | `console_accounts/keys.mjs` | same SHA-256 + hint; `api_credits` (RPC billing) deliberately NOT reused — it is a different money path |
| MCP over the Stage 12 ToolRegistry | `api/mcp.mjs` | three tools added through `defineTool` (lint + tiers apply) |
| orchestrator, scorecard, shadow revenue | items 8, 6, 1 | evaluate = orchestrator run; usage = `usage_charge` events |

Two reviewed changes to existing code:
1. `api/middleware.mjs` `authenticate` now keeps `kind: 'machine'` and the key's `agentKey` (scope / budget / mandate); before, every non-human became `agent` and the key context was dropped.
2. `agent/tool_registry.mjs`: the `eval` forbidden pattern is now a whole token `(^|_)eval(_|$)` — it matched `evaluate_opportunity` as a substring. `eval`, `run_eval`, `eval_js`, `js_eval_code` are still forbidden (regression test added).

## Test evidence (2026-10-07)

| Suite | Result |
|---|---|
| `apps/api/test/trading_machine_interface.test.js` | **12 passing**: key issue (human owner only; hash stored, raw key never; other owner's agent refused; EXECUTE needs a mandate); resolve / revoke → 401; evaluate → GO JSON with the documented fields and "not a probability of profit", orchestrator task carries owner + acting principal + machine request id, metered once (idempotent replay not billed); draft pricing → simulated revenue book only; 429 / 402 calls / 402 USD / 400; budget resets at the next UTC day; human session → AGENT_KEY_REQUIRED; READ cannot propose; PROPOSE → pending_review, no order fields; mandate binding (MANDATE_MISMATCH) and Mode B candidates; receipts owner-only; MCP tools registered, no placeOrder / withdraw; 501 without a machine port |
| `apps/api/test/trading_api.test.js` (Stage 24 incl. OpenAPI contract) | **22 passing** |
| `apps/api/test/trading_agent_tools.test.js` (Stage 12 incl. eval regression) | **30 passing** |
| `database/__tests__/trading-agent-access.integration.test.ts` (local Postgres) | **4 passing**: issue / resolve / revoke, only the hash in the DB, one key per principal; budgets from Postgres usage, idempotent metering (UNIQUE request id), USD then call budget exhausted, next-day reset, usage append-only; constraints; down migration |
| All trading integration suites | **18 files, 68 passing** |
| Mutation checks (10) | all caught: scope, rate limit, call budget, USD budget, draft usage booked as real, mandate binding, cross-owner receipts, revoked keys accepted, agents issuing keys, agentKey dropped by auth |

## Blocker impact

| Blocker | Touched? | Why the stage stays inside the accepted isolation |
|---|---|---|
| B-03 / B-06 / B-10 | yes (routes + migration 035) | routes exist only in the unmounted trading router; 035 applied only to local ephemeral databases |
| B-09 (pricing / legal) | yes, **not resolved** | prices are a draft; usage only in the simulated book |
| B-02 | yes | agent proposals go to human review; the queue itself is item 13 |
