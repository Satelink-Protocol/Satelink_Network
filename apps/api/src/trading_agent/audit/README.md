# trading_agent/audit

**Status:** skeleton (Stage 09). No routes, no jobs, no reads or writes yet.

**Responsibility:** Append-only audit trail for trading, credential and mandate actions. Not subject to data-retention pruning.

**Tables** (database/migrations/021_trading_foundation.sql): `audit_events`

**Flags** (all default OFF; see ../flags.mjs): `TRADING_AGENT`

**Rules:**
- Money is NUMERIC minor units + currency + decimals; never JS floats in new code (use `libs/kernel` Money semantics).
- No side effects unless the relevant flag is on and the deterministic policy in `risk/` + `mandates/` allows it.
- LLM output is data (signals/proposals), never a command.
