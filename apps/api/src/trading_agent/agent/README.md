# trading_agent/agent — agent tool layer (Stage 12)

**The LLM proposes; deterministic code decides.** A model can act only through the `ToolRegistry`, which has two tiers:
- **READ:** data through injected read ports.
- **CONTROLLED:** creates a *proposal* through a proposal sink.

There is no execution tier. `place_order`, `cancel_order`, `withdraw`, `transfer`, credential tools, `execute_*`, shell/SQL/HTTP tools and similar names **cannot be registered**, and a model's attempt to call them is rejected and traced.

**Status:** not mounted, not imported by `app_factory.mjs`, no public API. The existing AI gateway (`workloads/ai_gateway`) is untouched.

| Module | Purpose |
|---|---|
| `tool_registry.mjs` | tiers, forbidden-name patterns, capability-scoped contexts (READ gets `{read}`, CONTROLLED gets `{read, proposals}`), input/output schema validation, untrusted wrapping of every result |
| `tools.mjs` | the approved tool set (founder-approved substitute for "Document A Part E"): 9 READ + 4 CONTROLLED |
| `schema.mjs` | dependency-free JSON-Schema subset; every tool input/output and every structured model output is re-validated; unknown keys rejected by default |
| `untrusted.mjs` | `wrapUntrusted` / `renderUntrusted`: notice + content-derived id + delimiters that content can't close (`</untrusted_data`, `<system>` etc. are neutralized) |
| `redaction.mjs` | deep redaction (secret-looking keys; key/token/JWT/PEM/0x-private-key/connection-URL values) applied before any trace is stored |
| `provider.mjs` | `AIProvider` (`chat`, `reason`, `structuredOutput` with mandatory re-validation, `stream`) + deterministic `ScriptedProvider` |
| `providers/groq.mjs` | `GroqProvider`: the codebase's existing provider behind the interface; **injected** API key and `fetch`; retryable = 429/5xx/network |
| `router.mjs` | `ModelRouter`: per-task route chains; falls back **only** on retryable provider errors; every attempt traced |
| `trace.mjs` | `TraceRecorder` → `agent_runs` / `tool_calls` / `model_traces` (migration 023) via `InMemoryTraceStore` / `PgTraceStore` |
| `runtime.mjs` | `AgentRunner`: bounded loop (max steps), system rules, tool results fed back only as rendered untrusted data |
| `boundary.mjs` | import-boundary lint: no credentials, execution, broker adapters, DB/Redis/fs/net/child_process, `process.env`, dynamic `import()` or `require()` |
