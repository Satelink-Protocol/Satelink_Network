# trading_agent (Stage 09 foundation)

In-repo **module** inside `apps/api`, per `docs/trading-agent/audit/02-architecture.md` §6: modules first. The live API imports no workspace packages, and adding one would change Railway's workspace resolution and the lockfile. Pure, shared trading logic can move to a `libs/agent-core` package later (`05-ai-agents.md` §6). Execution and signing will live in a **separate deployable** with static egress and KMS (`08-deploy.md` §4–5).

## Status
- **Skeleton only.** Every subdomain exports `DOMAIN`, `TABLES`, `FLAGS`, `STATUS` and nothing else.
- **Not mounted.** `apps/api/app_factory.mjs` does not import this module. `mountTradingRoutes(app)` is a no-op unless `TRADING_FLAG_TRADING_AGENT=true`, and even then it exposes only `GET /v1/trading/status` (flag booleans).
- **Schema:** `database/migrations/021_trading_foundation.sql` (additive, 14 new tables). Its down migration is `database/migrations-down/021_trading_foundation.down.sql`, for local or ephemeral databases only.

## Flags (`flags.mjs`)
All default **OFF**. The env var is `TRADING_FLAG_<NAME>` and must be exactly `'true'` to enable.

| Flag | Locked |
|---|---|
| TRADING_AGENT, BINANCE, UPSTOX_COPILOT, ALPACA, LIVE_SMALL, BYOK, MCP_TRADING, REVENUE_ENGINE, SUBSCRIPTIONS | no |
| **LIVE_TRADING, AUTONOMOUS_MODE, UPSTOX_AUTOMATED** | **yes.** Always false regardless of env; unlocking is a reviewed code change |

## Subdomains
`brokers/`, `credentials/`, `strategies/`, `signals/`, `risk/`, `mandates/`, `orders/`, `execution/`, `positions/`, `outbox/`, `audit/`. Each has its own README stating its responsibility and rules.

## Boundary rules
1. An LLM or a strategy **proposes** (`signals`). Deterministic `risk/` + `mandates/` **decide**. Only `execution/` has side effects.
2. Money: `NUMERIC(38,0)` minor units + `currency` + `decimals`; quantities and prices `NUMERIC(38,18)`. No floats.
3. Broker secrets: metadata and ciphertext live in separate tables. Envelope encryption uses a KMS-wrapped DEK. Never log secrets and never place them in an LLM context.
4. The trading module never mutates `api_credits`, the ledger, revenue or settlement tables directly. Ledger postings go through the Financial-OS write path in a later stage.
