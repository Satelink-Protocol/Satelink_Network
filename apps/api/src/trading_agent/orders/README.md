# trading_agent/orders

**Status:** skeleton (Stage 09). No routes, no jobs, no reads or writes yet.

**Responsibility:** Order state machine with idempotency keys; every transition appended to order_events (append-only).

**Tables** (database/migrations/021_trading_foundation.sql): `orders`, `order_events`

**Flags** (all default OFF; see ../flags.mjs): `TRADING_AGENT`, `LIVE_TRADING`, `LIVE_SMALL`

**Rules:**
- Money is NUMERIC minor units + currency + decimals; never JS floats in new code (use `libs/kernel` Money semantics).
- No side effects unless the relevant flag is on and the deterministic policy in `risk/` + `mandates/` allows it.
- LLM output is data (signals/proposals), never a command.
