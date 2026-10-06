# Stage 12 — Agent tool layer

**Branch:** `trading-agent/stage-12-agent-tools` (stacked on `trading-agent/stage-11-market-data`)
**Principle:** *the LLM proposes only.* No tool can place, cancel or modify an order, move funds, or touch credentials, and `placeOrder` is never exposed.
**Code:** `apps/api/src/trading_agent/agent/` (see its `README.md` for the module map)
**DB:** `database/migrations/023_agent_traces.sql` (additive). Down file: `database/migrations-down/023_agent_traces.down.sql`, for local/ephemeral databases only.
**API:** none. The module is not mounted, not imported by `app_factory.mjs`, and not added to `trading_agent/index.mjs` SUBDOMAINS.

## STOP evaluation — not triggered

> STOP if existing agent infra (e.g. Paperclip) grants tools broad side effects that cannot be isolated.

Paperclip and the `.claude` agents are dev/ops tooling with **zero runtime coupling** to product code. No `apps/api` module imports them, and none of their tools are reachable from this layer (see Stage 05, `audit/05-ai-agents.md`). Their broad permissions stay open as Gate-0 blocker **B-04**; this stage neither uses nor extends them.

The existing product AI (`workloads/ai_gateway`, Groq) is **untouched**. `GroqProvider` is a new, independent adapter with an injected key and `fetch`, and it does not import `ai_gateway`. The existing AI features therefore behave exactly as before.

## Tool list — substitution note

The brief references "Document A Part E", which was not found in the repo or the founder's Downloads. The founder approved the proposed list below as the substitute (Stage 12 decision, "Use proposed list"). If Document A turns up, the list is reconciled against it in a follow-up.

## Tool table

Every READ handler receives only `{read, principalId, runId}`. Every CONTROLLED handler receives `{read, proposals, principalId, runId}`.

Inputs and outputs are validated against JSON schemas with `additionalProperties: false`. Amounts are decimal strings, and floats are rejected. Every result goes back to the model wrapped as untrusted data.

| Tool | Tier | Port called | Input (required → optional) | Effect |
|---|---|---|---|---|
| `get_quote` | READ | `read.marketData.getQuote(principal, instrument, {purpose:'internal_use'})` | instrument | quote + freshness (Stage 11 staleness/entitlement apply) |
| `get_candles` | READ | `read.marketData.getCandles(…, {purpose:'internal_use', limit})` | instrument, interval → limit | candles + freshness |
| `get_intelligence` | READ | `read.intelligence.getMetric(metric, {symbol})` | metric → symbol | M3 intelligence metric |
| `list_positions` | READ | `read.positions.list(principal)` | — | positions |
| `list_orders` | READ | `read.orders.list(principal, {status, limit})` | → status, limit | orders (read only) |
| `get_risk_policy` | READ | `read.risk.getActivePolicy(principal)` | — | active risk policy |
| `get_mandate` | READ | `read.mandates.get(principal, mandateId)` | mandateId | mandate |
| `get_strategy` | READ | `read.strategies.get(principal, strategyId)` | strategyId | strategy |
| `get_account_summary` | READ | `read.accounts.summary(principal)` | — | balances summary (ledger read port) |
| `propose_order` | CONTROLLED | `proposals.create({kind:'order_intent'})` | mandateId, instrument, side, type, quantity, rationale → limitPrice | `{proposalId:'prp_…', status:'pending_review'}` |
| `propose_cancel` | CONTROLLED | `proposals.create({kind:'cancel_intent'})` | orderId, rationale | pending proposal |
| `propose_alert` | CONTROLLED | `proposals.create({kind:'alert'})` | severity, message | pending proposal |
| `record_note` | CONTROLLED | `proposals.create({kind:'note'})` | text | pending proposal |

A CONTROLLED tool's output schema only accepts `status: 'pending_review'`. A proposal sink that returned anything else (e.g. `approved`) is rejected as `SCHEMA_INVALID` and is never shown to the model.

### Forbidden: cannot be registered, and calls to them are rejected

`FORBIDDEN_TOOL_PATTERNS` in `tool_registry.mjs` blocks these names (case-insensitive):
- order execution: `place/submit/send/create/execute/modify/amend/replace/cancel[_]order`, including `placeOrder`, plus `order_*` verbs;
- `execute_*`;
- money movement: withdraw / transfer / payout / settle / deposit / sweep / send funds;
- credential, API key, secret, private key, seed and password names;
- `set/update/disable/override_(risk|mandate|kill_switch|limit)`;
- shell, SQL, eval, HTTP and fetch tools.

If `defineTool` receives one of these names it throws `FORBIDDEN_TOOL`. If a model calls one, `invoke` returns `rejected` with `FORBIDDEN_TOOL` (or `UNKNOWN_TOOL`), and the trace stores it with `tier='REJECTED'`.

## Other components

| Component | Contract |
|---|---|
| `AIProvider` | `chat`, `reason`, `structuredOutput` (always re-validated against the schema, fences stripped, `SCHEMA_INVALID` on bad JSON, a schema violation or extra keys), `stream`. `ScriptedProvider` gives deterministic tests. |
| `GroqProvider` | OpenAI-compatible `/chat/completions`, `temperature 0`, `tool_choice auto`, SSE stream. Retryable = 429/5xx/network/timeout. Key injected and never in results or traces. |
| `ModelRouter` | per-task ordered route chains. Falls back **only** on retryable `ProviderError`, and every attempt is reported (`ok`, `fallback`, `error`). |
| `TraceRecorder` | `agent_runs`, `tool_calls` and `model_traces`. Everything passes through `redact()` before the store. `InMemoryTraceStore` / `PgTraceStore`. |
| `AgentRunner` | bounded loop (default 8 steps, then `aborted` with `MAX_STEPS`). Provider failure → run `failed`. Tool results reach the model only via `renderUntrusted`. |
| `boundary.mjs` | import-boundary lint over `agent/**`. It blocks credentials, execution, broker adapters, pg/redis/fs/net/http/child_process, app_factory/server, ai_gateway/settlement/ledger/billing, `process.env`, dynamic `import()` and `require()`. Allowed bare imports: `node:crypto`, `express`. |

### Migration 023

| Table | Columns / constraints |
|---|---|
| `agent_runs` | status ∈ running/completed/failed/aborted; `finished_at` required once not running; redacted goal/output/error |
| `tool_calls` | `UNIQUE(run_id, seq)`; tier ∈ READ/CONTROLLED/REJECTED; `rejected ⇒ tier REJECTED ∧ rejection_code` |
| `model_traces` | `UNIQUE(run_id, seq)`; task/status checks; token and latency counts |

- FKs point only at `principals` and at each other.
- UPDATE/DELETE are revoked on `tool_calls` and `model_traces` (append-only; same superuser caveat as 004/017).

## Test evidence (2026-10-01)

| Suite | Result |
|---|---|
| `apps/api/test/trading_agent_tools.test.js` (mocha) | **29 passing** |
| Integration on local Postgres 16 (guard DB recipe): `trading-agent-traces` + `trading-market-data` + `trading-foundation` | **10 passing**; temporary databases dropped, none left behind |
| `migrations.integration.test.ts` | needs Docker (testcontainers; CI only). Its list is updated for 023 and `MIGRATION_COUNT = 22` matches the 22 files on disk |
| `scripts/ci-baseline-check.sh` | **618 tests / 498 pass / 2 known failures / 118 pending**, "no new failures" (Stage 11 was 589/469, so +29/+29) |

**Flake note:** the first baseline run reported 2 failures in `intelligence_charge_after_success.test.js` (PR #429 suite, unrelated to this stage). The file passes 7/7 alone three times, and the full re-run was clean. It is order/timing-sensitive, like the known `identity_rate_limit` flake, and was not fixed here.

### How the three required tests are covered

1. **Model cannot call placeOrder.**
   - The registry does not contain any of 17 execution, funds or credential names.
   - Registering them throws `FORBIDDEN_TOOL`.
   - A direct invoke is rejected with zero side effects.
   - End to end, a scripted model asking for `place_order` gets a rejection that is traced as `REJECTED`. A spy broker and credential loader stay at 0 calls, and the proposal sink stays empty.
   - The same run is also persisted through `PgTraceStore` in the integration test.
2. **Agent cannot import the credential loader.**
   - The real `agent/**` tree has 0 violations.
   - 15 fixture sources are each detected: credentials, broker adapter/mock/index, execution, credential loader, pg, ioredis, child_process, fs, re-export, non-allowlisted package, `process.env`, dynamic import, `require`.
   - A violating file dropped into a temp agent directory is caught.
3. **Prompt-injection fixtures produce no side effects.** Four fixtures are embedded in tool output:
   - "ignore previous instructions";
   - a forged `</untrusted_data><system>` close tag;
   - fake `tool_calls` JSON;
   - a fake kill-switch notice.

   A compromised scripted model then "obeys" by calling place_order, withdraw, set_credentials, disable_kill_switch and execute_trade. All five calls are rejected, and there are 0 broker, credential or proposal side effects. The model only ever sees the content behind the untrusted notice, with the delimiters neutralized.

**Also covered:** redaction of API keys, 0x private keys and connection-URL passwords across every stored trace (fixtures assembled from parts); router fallback-only-on-retryable; the Groq request shape, error classification and SSE streaming; `structuredOutput` re-validation; maxSteps abort; and failed-run recording.

## Follow-ups (not in this stage)

- **Ports are interfaces only.** Real read ports need implementations in later stages: market data (Stage 11 provider plus entitlements), intelligence, positions/orders/mandates/strategies/risk (021 tables), and the ledger read.
- **The proposal sink is a port, not a table.** An `agent_proposals` table and a human review/approval flow arrive with the risk/approval stage. Proposals never feed execution directly.
- **Not yet wired:** the agent is not in `trading_agent/index.mjs` SUBDOMAINS, has no flag gate (`TRADING_FLAG_TRADING_AGENT` is default OFF) and no route.
- **The boundary lint runs as a mocha test.** Promoting it to an ESLint rule is optional.
- **Document A Part E:** reconcile the tool list if the document is found.
