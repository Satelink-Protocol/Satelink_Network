# trading_agent/brokers

**Status:** skeleton (Stage 09). No routes, no jobs, no reads or writes yet.

**Responsibility:** Broker account registry and connector adapters (Binance, Upstox, Alpaca). Adapters run only in the isolated execution service with static egress (audit/08 §4); nothing here calls a broker yet.

**Tables** (database/migrations/021_trading_foundation.sql): `broker_accounts`

**Flags** (all default OFF; see ../flags.mjs): `BINANCE`, `UPSTOX_COPILOT`, `UPSTOX_AUTOMATED`, `ALPACA`

**Rules:**
- Money is NUMERIC minor units + currency + decimals; never JS floats in new code (use `libs/kernel` Money semantics).
- No side effects unless the relevant flag is on and the deterministic policy in `risk/` + `mandates/` allows it.
- LLM output is data (signals/proposals), never a command.
