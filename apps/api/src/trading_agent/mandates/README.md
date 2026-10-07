# trading_agent/mandates

**Status:** skeleton (Stage 09). No routes, no jobs, no reads or writes yet.

**Responsibility:** User mandates authorising an agent to trade within limits. Activation requires approval + step-up (passkey/TOTP), enforced by a CHECK constraint.

**Tables** (database/migrations/021_trading_foundation.sql): `mandates`

**Flags** (all default OFF; see ../flags.mjs): `UPSTOX_COPILOT`, `UPSTOX_AUTOMATED`, `AUTONOMOUS_MODE`

**Rules:**
- Money is NUMERIC minor units + currency + decimals; never JS floats in new code (use `libs/kernel` Money semantics).
- No side effects unless the relevant flag is on and the deterministic policy in `risk/` + `mandates/` allows it.
- LLM output is data (signals/proposals), never a command.
