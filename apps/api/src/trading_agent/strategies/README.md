# trading_agent/strategies

**Status:** Stage 13 strategy DSL. `STATUS = 'skeleton'` means *not wired at runtime*: no routes, no jobs, not mounted.

**Responsibility:** user strategies as deterministic, auditable documents, with immutable, content-hashed versions and a guarded lifecycle.

**Tables** (migration 021; no new migration): `strategies` (status = projection), `strategy_versions` (append-only), plus `audit_events` (the lifecycle log).

**Flags:** `TRADING_AGENT` (to enter PAPER), plus `LIVE_SMALL` / `LIVE_TRADING` for live states. `LIVE_TRADING` is LOCKED, so no live state is reachable.

| Module | Purpose |
|---|---|
| `dsl_schema_v1.mjs` | DSL v1.0 JSON Schema (2020-12) + hard limits. `x-decimal` annotation bounds decimal strings |
| `validator.mjs` | dependency-free validator for the subset the schema uses. Objects are strict (unknown fields rejected), integers must be safe, unknown keywords are a CONFIG error. Iterative shape pre-check (depth, nodes, `__proto__`) |
| `canonical.mjs` | schema-driven normalisation (defaults, canonical decimals, NFC) → JCS canonical JSON → `sha256:` hash |
| `dsl.mjs` | `parseStrategyDsl`: version dispatch → shape → schema → normalise → re-validate → semantic checks → size → hash |
| `fixed.mjs`, `indicators.mjs` | 18-dp fixed-point bigint maths (half-even); SMA, EMA, Wilder RSI, Wilder ATR, highest, lowest |
| `compiler.mjs` | `compileStrategy` → frozen pure evaluator: `evaluate({candles, position?, barsSinceLastExit?})` → `enter` / `exit` / `hold` + reasons |
| `lifecycle.mjs` | 7-state machine, explicit edge table, guards (actor kind, evidence bound to the content hash, flags) |
| `service.mjs` | `StrategyService` + `InMemoryStrategyStore` / `PgStrategyStore` (row lock + expected-state check) |

**Rules:**
- A definition is identified by its hash. Changing anything means a new version; versions are never edited.
- The evaluator only emits signals. Sizing, risk, mandates and execution belong to later stages behind their own flags.
- Agents (LLM principals) can neither author strategies nor move them through the lifecycle.
