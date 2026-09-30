# trading_agent/strategies

**Status:** skeleton (Stage 09). No routes, no jobs, no reads or writes yet.

**Responsibility:** User strategies and immutable, hashed versions (strategy_versions is append-only).

**Tables** (database/migrations/021_trading_foundation.sql): `strategies`, `strategy_versions`

**Flags** (all default OFF; see ../flags.mjs): `TRADING_AGENT`

**Rules:**
- Money is NUMERIC minor units + currency + decimals; never JS floats in new code (use `libs/kernel` Money semantics).
- No side effects unless the relevant flag is on and the deterministic policy in `risk/` + `mandates/` allows it.
- LLM output is data (signals/proposals), never a command.
