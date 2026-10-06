# trading_agent/risk

**Status:** Stage 15 deterministic pre-trade risk engine. `STATUS = 'skeleton'` means *not wired at runtime*: no routes, not mounted, nothing calls `decide()` yet.

**Responsibility:** the only gate between a proposed order and execution. It is deterministic code; no LLM is anywhere in this path.

**Tables:**
- `risk_policies` (021 + 025 columns): immutable versions.
- `kill_switch_events` (025): append-only.
- `audit_events` (021): decision records, `action = 'risk.decision'`.

| Module | Purpose |
|---|---|
| `checks.mjs` | the ordered checks 1–20 (`CHECKS_VERSION risk-checks/1.0`): pure `(order, ctx) → PASS / rejection` |
| `evaluate.mjs` | fail-closed ordered evaluation. A throw or malformed result means REJECT. APPROVE only for the complete canonical registry with all 20 passing |
| `engine.mjs` | `RiskEngine.decide`: context load with timeout → checks → breaker trip → decision record. Anything failing means REJECT; an unrecorded approval is a REJECT |
| `kill_switch.mjs` | scopes (global → instrument), latest-event-wins, broadest-first reporting, engage / release permissions |
| `kill_switch_service.mjs` | `KillSwitchService` engage / release |
| `policy.mjs` | policy schema, `HARD_CAPS`, plan-cap checks, `RiskPolicyService` (versions; users within plan caps, admins within hard caps, agents never) |
| `store.mjs` | `InMemoryRiskStore`, `PgRiskStore` (policy integrity re-hash on read) |

**Context:** `decide()` needs an injected `loadContext(order)` that returns the snapshot the checks read: policy, kill switches, account, mandate, strategy, instrument, quote, account balances and activity. A database-backed loader comes with the execution stage. Until then, every missing field rejects.
