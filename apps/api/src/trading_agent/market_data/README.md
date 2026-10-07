# trading_agent/market_data

**Status:** Stage 11 abstraction. **Internal only:** there is no route and no connection to production Redis, and `app_factory.mjs` does not import it. The Binance provider is a stub; it gets implemented in Stage 21.

## Pieces
| File | Purpose |
|---|---|
| `types.mjs` | `Dataset`, `Purpose` (`internal_use` / `display` / `redistribution`), `CandleInterval`, `normalizeQuote` (rejects crossed quotes), `normalizeCandle` (OHLC consistency, derived `closeTime`), `MarketDataError` |
| `staleness.mjs` | `defineStalenessPolicy`, `computeStaleness` (deterministic, injected `now`; measured from the **venue** timestamp; the `ageMs == maxAgeMs` boundary is fresh; future timestamps are stale), `withStaleness`, `cacheTtlFor` (TTL **must be < threshold**) |
| `entitlements.mjs` | Deny-by-default `EntitlementService`; `InMemoryEntitlementStore`, `PgEntitlementStore` (`market_data_entitlements`, migration 022). `redistribution` is never implied by the other scopes |
| `cache.mjs` | `InMemoryLruCache` (default, bounded), `RedisMarketDataCache` (injected client only). Keys are forced into `trading:md:v1:*`; every key has a TTL; values are size-capped |
| `provider.mjs` | `MarketDataProvider`: entitlement → cache (re-checked for staleness) → fetch → normalize → cache → `{ data, freshness, cache }` |
| `binance_public_provider.mjs` | Stub with capabilities and planned endpoints; fetches throw `NOT_IMPLEMENTED` |

## Redis decision (founder, 2026-09-30)
The only Redis is shared with production RPC: same DB 0, no key prefix, money-path keys such as `billing:dedup:*`, and an unknown eviction policy. The cache is therefore pluggable. The in-process LRU is the default, and `RedisMarketDataCache` is **never** wired to the production client. Wire it only to a dedicated trading Redis (e.g. `REDIS_TRADING_URL`) once one is provisioned.

## Rules
- Risk code must reject any result whose `freshness.stale` is true.
- No raw data leaves the entitled principal without an active `redistribution` grant.
- Prices and sizes are decimal strings; never JS floats.
