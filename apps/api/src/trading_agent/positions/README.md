# trading_agent/positions

**Status:** skeleton (Stage 09). No routes, no jobs, no reads or writes yet.

**Responsibility:** Positions derived from fills (snapshot table). No performance claims in UI (audit/03 truth-lint).

**Tables** (database/migrations/021_trading_foundation.sql): `positions`

**Flags** (all default OFF; see ../flags.mjs): `TRADING_AGENT`

**Rules:**
- Money is NUMERIC minor units + currency + decimals; never JS floats in new code (use `libs/kernel` Money semantics).
- No side effects unless the relevant flag is on and the deterministic policy in `risk/` + `mandates/` allows it.
- LLM output is data (signals/proposals), never a command.
