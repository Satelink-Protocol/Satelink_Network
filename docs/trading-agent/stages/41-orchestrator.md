# Stage 41 — AI orchestrator + specialized agents (Phase 6 item 8)

## Inspection (reuse before build)

| Existing | Where | Used how |
|---|---|---|
| ToolRegistry (READ / CONTROLLED tiers, forbidden names, schema-checked I/O) | `agent/tool_registry.mjs`, `agent/tools.mjs` (Stage 12) | the orchestrator's ONLY data path; agents' tools must be READ-tier (checked at construction) |
| untrusted-data wrapping | `agent/untrusted.mjs` | every tool result and scorecard summary reaches a model wrapped |
| tiered router + cost metering | item 3 | every agent call (task type → tier), attributed to opportunity / strategy / machine request |
| trace recorder | `agent/trace.mjs` | one `agent_runs` row per task = the trace id |
| Strategy DSL parser | `strategies/dsl.mjs` (Stage 13) | validates the Strategy agent's DSL; invalid → REJECT, no decision request |
| scorecard | item 6 | the only decider |

The existing single `AgentRunner` (model-driven tool loop) is kept for chat; the orchestrator does NOT
let models call tools — it fetches READ data deterministically from the task.

## Test evidence (2026-10-07)

| Suite | Result |
|---|---|
| `apps/api/test/trading_orchestrator.test.js` | **12 passing**: routing per task (no `place_order` task); READ-only tool allow-lists, a CONTROLLED tool refused at construction; opportunity run → GO with 4 agents, exactly the 7 READ tools, no proposal write, no order fields, one trace id, cost attribution; **prompt-injection quote reaches the model only wrapped, forged delimiters neutralised, nothing written**; an agent "claiming GO" cannot override a failed gate; a failing agent is recorded and the deterministic decision stands; propose_strategy: GO with accepting challenger, **blocking objection → WAIT**, **challenger failure → WAIT (never GO)**, challenger cannot rescue a REJECT, invalid DSL → REJECT with no decision request; static: no OMS / broker / credential / env / dynamic import |
| `database/__tests__/trading-orchestrator.integration.test.ts` (local Postgres) | **1 passing**: one run id ties `agent_runs` (completed, 4 steps), 7 `tool_calls`, 4 metered `model_traces` (standard tier, 3 000 µUSD each, `opp_9`) and the `trading_decisions` GO; `costBy('opportunity')` = 12 000 µUSD |
| Mutation checks (9) | all caught: challenger ignored, failed challenger treated as accept, non-READ tool allowed, tool data unwrapped, recommendation not from the scorecard, invalid DSL proceeds, challenger not routed, over-routing, cost attribution lost |

No real model call was made (scripted providers).

## Blocker impact

| Blocker | Touched? | Why the stage stays inside the accepted isolation |
|---|---|---|
| B-02 (human approval flow) | no | the orchestrator writes no proposal; the review queue is item 13 |
| B-03 / B-06 / B-10 | no | not mounted; no migration |
| B-04 (model keys) | no | providers injected; the composition root takes keys from the caller |
