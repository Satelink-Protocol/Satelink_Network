# Stage 11 — Market data abstraction

- **Date:** 2026-09-30 (IST).
- **Branch:** `trading-agent/stage-11-market-data`, **stacked on** `trading-agent/stage-10-broker-abstraction` (PR #465 → #464 → `trading-agent/integration`). PR base = `trading-agent/stage-10-broker-abstraction`. Nothing reaches `main`.
- **Scope:** `apps/api/src/trading_agent/market_data/**`, migration `022` (+ down), tests, this doc. No existing code, route, flag file or Redis namespace touched.

## 0. STOP: Redis shared with production → founder decision

**Finding (evidence):**
- **Shared instance:** both production Redis clients connect to the same `REDIS_URL` (DB 0, **no key prefix**): `apps/api/server.js:40-58` (`createRedisClient`, the shared `redis` passed to routers and jobs) and `apps/api/src/workloads/rpc_gateway/shared_redis.js:14-60`.
- **Money-path keys live there:** e.g. `billing:dedup:<requestId>` (`workloads/rpc_gateway/rpc_billing.js:60-66`, a 60 s guard against double-billing RPC calls), free-tier counters `ft:*`/`fts:*`/`ftua:*`, MEV key caches (02-architecture §4).
- **`maxmemory` / eviction policy: UNKNOWN.** There is no config in the repo; `autonomous/capacity_alerter.js:57-75` only reads `INFO memory` at runtime and reports "unlimited" when `maxmemory` is 0.
- **Prefix already taken:** `market:` is used by vNext journal streams (`vnext/market/market_store.js:32-56`), so it can't be reused.

→ **STOP condition met.**
- **Eviction risk:** an LRU policy could evict `billing:dedup:*` early (a double-billing window). With no limit, Redis could run out of memory and lose every production key.
- **Collisions:** avoidable with a unique prefix.

**Founder decision (2026-09-30): "Pluggable cache, not wired."**
- **Default backend:** a **bounded in-process LRU** (`InMemoryLruCache`).
- **Redis backend:** `RedisMarketDataCache` accepts only an **injected** client, is tested against a fake client, and is **not connected to the production Redis** anywhere.
- **Future wiring:** only to a **dedicated** trading Redis (e.g. `REDIS_TRADING_URL`) that the founder provisions.
- **Namespace:** both backends refuse any key outside `trading:md:v1:*`, so existing namespaces are unreachable by construction. A static test asserts no `market_data` module imports `ioredis`, `shared_redis`, `redisClient`, `server.js` or `app_factory`, or reads `process.env.REDIS*`.

## 1. What was built

| File | Contents |
|---|---|
| `types.mjs` | `Dataset` (quotes, candles, order_book, trades), `Purpose` (internal_use, display, redistribution), `CandleInterval`, `normalizeQuote` (decimal strings; rejects crossed bid>ask; venue `sourceTimestamp` + local `receivedAt`), `normalizeCandle` (OHLC consistency, derived `closeTime`), `MarketDataError` |
| `staleness.mjs` | `defineStalenessPolicy({maxAgeMs, maxFutureSkewMs})`; `computeStaleness(item, policy, now)`, **deterministic** (injected `now`), measured from the **venue** timestamp (quote `sourceTimestamp`; candle `closeTime` if closed else `updatedAt`); boundary `ageMs == maxAgeMs` is fresh, `+1 ms` is stale; future timestamps beyond skew are stale; `withStaleness`; `cacheTtlFor` (**TTL must be < threshold**, else CONFIG error) |
| `entitlements.mjs` | Deny-by-default `EntitlementService.assertAllowed({principalId, venue, dataset, purpose})`. Purpose→scope: internal_use ← {internal_use, display, redistribution}; display ← {display, redistribution}; **redistribution ← {redistribution} only**. `InMemoryEntitlementStore`, `PgEntitlementStore` (parameterized, active + in-window) |
| `cache.mjs` | `marketDataKey()` (validated parts, `trading:md:v1:` prefix), `InMemoryLruCache` (TTL, LRU bound, value-size cap, injected clock), `RedisMarketDataCache` (injected client, `SET … PX ttl`, same guards) |
| `provider.mjs` | `MarketDataProvider`: entitlement → cache → fetch → normalize → cache → `{data, freshness, cache: miss/hit/stale_refetched}`. Cached data is **re-evaluated** for staleness (a cache hit never makes data fresh); construction fails if a TTL ≥ its threshold |
| `binance_public_provider.mjs` | `BinancePublicDataProvider` stub + capabilities; fetch hooks throw `NOT_IMPLEMENTED` (Stage 21). Records the planned public endpoints, the **US geo-block** (all Railway services in `us-west2`) and the pending legal review of redistribution terms |
| `index.mjs`, `README.md` | exports and docs. Not added to `trading_agent/index.mjs` `SUBDOMAINS` (that file is outside this stage's allowed paths); a later wiring stage registers it |

**Migration `022_market_data_entitlements.sql`** (additive; FK only to `principals`): `market_data_entitlements(id, principal_id, venue, dataset, scope, status, source_terms_ref, granted_by, valid_from, valid_until, created_at, revoked_at)`. It adds CHECKs on enumerations, `valid_until > valid_from`, `revoked ⇒ revoked_at`, and a partial unique index (one **active** grant per principal/venue/dataset/scope). Down file: `database/migrations-down/022_market_data_entitlements.down.sql` (local/ephemeral only). `database/__tests__/migrations.integration.test.ts` expects 022; the count is now 21.

**Internal only:** no route or HTTP surface; not imported by `app_factory.mjs`. **Security:** raw data never goes beyond the entitled principal without an explicit `redistribution` grant, and none will be granted before legal review (`docs/legal/MARKET_DATA_TERMS.md`).

## 2. Test evidence

| Check | Result |
|---|---|
| `npx mocha … test/trading_market_data.test.js` (+ Stage 09/10 trading tests) | **84 passing** (26 new) |
| Acceptance: **stale quote flagged deterministically** | an upstream quote 2 001 ms old against `maxAgeMs` 2 000 gives `{stale: true, reason: 'stale_age', ageMs: 2001, evaluatedAt: T0}`, identical across two independent runs; boundary 2 000 ms fresh / 2 001 ms stale |
| Cache expiry | in-memory entry present at TTL−1 ms, gone at TTL; provider refetches after expiry; a planted stale cache entry is refetched (`stale_refetched`); TTL ≥ threshold refused at construction |
| Entitlement denial | no grant; wrong principal/venue/dataset; revoked; expired; not-yet-valid; unknown purpose; display or internal grant used for redistribution → all `ENTITLEMENT_DENIED`, and **no upstream fetch happens** on denial |
| Namespace isolation | `billing:dedup:*`, `ft:*`, `market:*`, `trading:other` keys refused by both backends; Redis backend emits exactly `SET <trading:md:v1:…> <json> PX <ttl>` |
| Migration 022 up/down + real `PgEntitlementStore` on local Postgres 16 | **3 passed** (with Stage 09's 021 round trip: 7/7). Temp DBs dropped, 0 leftover |
| API baseline guard (CI env) | exit 0. **589 / 469 / 2 / 118** vs Stage 10's 563/443/2/118 → **+26 tests, +26 passes** |

## 3. Follow-ups
1. **Founder:** provision a dedicated Redis for trading (or confirm prod `maxmemory-policy` read-only) before any Redis wiring.
2. **Stage 21:** implement Binance public fetch from a non-US egress region; populate `InstrumentRegistry`; re-verify endpoints.
3. **Wiring stage:** register `market_data` in `trading_agent/index.mjs` and inject `PgEntitlementStore(pool)`. Risk (a later stage) must reject `freshness.stale`.

## Rollback
Revert or close the PR. If migration 022 was applied to a local DB: `psql "<local url>" -f database/migrations-down/022_market_data_entitlements.down.sql`.
