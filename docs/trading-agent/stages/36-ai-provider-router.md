# Stage 36 — AI provider + model router tiers + cost metering (Phase 6 item 3)

## Inspection (reuse before build)

| Existing | Where | Used how |
|---|---|---|
| `AIProvider` interface (chat / reason / structuredOutput / stream), schema re-validation | `agent/provider.mjs`, `agent/schema.mjs` (Stage 12) | `AnthropicProvider` implements it; one-line `onUsage` hook added to the base `structuredOutput` for metering |
| `GroqProvider` | `agent/providers/groq.mjs` | unchanged; kept as the fallback provider |
| `ModelRouter` (fallback only on retryable `ProviderError`) | `agent/router.mjs` | reused as the chain engine; gained an optional `keys` list and now **awaits** `onAttempt` (it was fire-and-forget) |
| `model_traces` + `TraceRecorder` / `PgTraceStore` | migration 023, `agent/trace.mjs` | extended (migration 032) instead of a new cost table |
| import-boundary lint (no dynamic import / env / credentials in `agent/**`) | `trading_agent_tools.test.js` | respected: the SDK is imported only by `trading_agent/ai_providers.mjs`, outside `agent/**` |

## What was built

- **`AnthropicProvider`** (`agent/providers/anthropic.mjs`) on the official SDK **`@anthropic-ai/sdk` 0.131.0 — MIT** (it pulls in `json-schema-to-ts`, `ts-algebra`, both MIT; lockfile diff: +3 packages, 0 changed). Key from the caller only (explicit `apiKey`; the module never reads the environment). Translates the runtime's OpenAI-style turns (assistant `tool_calls`, role `tool` → merged `tool_result` user turn) and **replays a produced assistant turn verbatim, thinking blocks included** (bounded cache by tool_use id). Typed-error mapping: 429 / 5xx / 529 / connection / timeout → retryable; 400 / 401 / 403 / 404 → not. `stop_reason: "refusal"` → non-retryable `REFUSED`. `claude-opus-5` opts into **server-side refusal fallbacks** (`server-side-fallback-2026-07-01`, `fallbacks: "default"`). Structured output uses native `output_config.format` json_schema **and** is re-validated with Satelink's schema.
- **Tiers** (`agent/tiers.mjs`, config `model-router/1.0`), routed **by task type, never by user**:
  - `deterministic` — price, balance, P&L, risk check, order state, positions, indicators, scorecard → **refused** (`DETERMINISTIC_ONLY`), no provider called;
  - `fast` — claude-haiku-4-5 → groq llama-3.1-8b-instant;
  - `standard` — claude-sonnet-5 → groq llama-3.3-70b-versatile (effort medium);
  - `deep` — claude-opus-5 → claude-sonnet-5 (effort high).
- **`TieredModelRouter`** (`agent/tiered_router.mjs`): plan / complete; records every attempt (ok / fallback / error) with tier, task type, tokens (incl. cache read/write), cost and attribution; re-validates structured results itself (defence in depth).
- **Cost** (`agent/pricing.mjs`, `model-prices/2026-10-07`): integer micro-USD = tokens × $/MTok; cache write 1.25×, cache read 0.1×; rounds **up**. Anthropic first-party rates (Opus 5 $5/$25, Sonnet 5 $2/$10, Haiku 4.5 $1/$5). **Groq is UNPRICED** until the founder confirms the contract rate → `cost_priced = false`, never guessed.
- **Migration 032** (additive, nullable): `model_traces.tier, task_type, cache_read_tokens, cache_write_tokens, cost_usd_micro, cost_priced, price_version, strategy_id, opportunity_id, machine_request_id` + a check that a priced row carries a cost and version. `PgTraceStore.costBy(principal | strategy | opportunity | machine_request, {since, until})`.
- **Composition root** `trading_agent/ai_providers.mjs` → `createTieredRouter({ anthropicApiKey, groqApiKey })`. Not mounted anywhere.

## Test evidence (2026-10-07)

| Suite | Result |
|---|---|
| `apps/api/test/trading_ai_router.test.js` | **23 passing**: key injection (never env, no dynamic import); message translation; verbatim thinking replay; opus-5 fallbacks + effort; refusal → REFUSED; 7 typed-error mappings; native json_schema + re-validation (enum violation, non-JSON); tier map; deterministic refusal with **zero provider calls**; route independent of attribution; exact micro-USD incl. cache multipliers and round-up; unpriced model; fallback only on retryable; no fallback on 400; router-level re-validation against a provider that skips it; costBy for all four dimensions; SDK imported only by the composition root; not mounted |
| `apps/api/test/trading_agent_tools.test.js` (Stage 12, incl. import-boundary lint) | **29 passing** (unchanged) |
| Real-SDK interop (offline, SDK 0.131.0 in a scratch dir, fake fetch, no key) | key only in `x-api-key`; system prompt mapped; opus-5 → `/v1/messages?beta=true` with `anthropic-beta: server-side-fallback-2026-07-01`, `fallbacks: "default"`; thinking + tool_use replayed; json_schema output parsed + validated; 429 → retryable, 400 → not |
| `database/__tests__/trading-cost-metering.integration.test.ts` (local Postgres, guard-DB recipe) | **3 passing**: per-attempt rows (error → fallback → ok) with tier / task type / cost; `costBy` per user, strategy, opportunity, machine request and time window; priced-without-cost rejected; `satelink_app` cannot UPDATE; down migration keeps 023 data |
| All trading integration suites | **14 files, 55 passing** (032 added to the foundation down-chain + migrations list) |
| Mutation checks (11) | all caught: fallback on non-retryable, deterministic not refused, cost rounded down, cache read at full price, refusal treated as an answer, 429 non-retryable, thinking replay dropped, router skips re-validation (survived at first → a sloppy-provider test was added), attribution dropped, opus-5 without fallbacks, Pg insert drops cost |

## Not done here (later items)

Model calls are not yet made by any orchestrator or agent (item 8). No real API call was made: no Anthropic key is available to this session, and none was requested.

## Blocker impact

| Blocker | Touched? | Why the stage stays inside the accepted isolation |
|---|---|---|
| B-04 (model-provider key rotation) | yes, **not resolved** | keys are injected by the caller; nothing reads env; the leaked-key rotation stays a founder action |
| B-03 / B-06 / B-10 | yes (migration 032) | not mounted; 032 applied only to local ephemeral databases |
| B-07 (roles) | yes | 032 adds nullable columns only; 023's append-only REVOKE still applies (tested) |
| B-11 (licence) | checked | the new dependency and both transitives are MIT |
