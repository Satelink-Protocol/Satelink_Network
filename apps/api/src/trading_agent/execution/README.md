# trading_agent/execution

**Status:** skeleton (Stage 09). No routes, no jobs, no reads or writes yet.

**Responsibility:** Execution and fills. The ONLY side-effect path; lives in a separate deployable later (signer/execution service). Fills are append-only; fees post to the Financial-OS ledger in the same transaction (audit/04 U2).

**Tables** (database/migrations/021_trading_foundation.sql): `fills`

**Flags** (all default OFF; see ../flags.mjs): `LIVE_TRADING`, `LIVE_SMALL`

**Rules:**
- Money is NUMERIC minor units + currency + decimals; never JS floats in new code (use `libs/kernel` Money semantics).
- No side effects unless the relevant flag is on and the deterministic policy in `risk/` + `mandates/` allows it.
- LLM output is data (signals/proposals), never a command.
