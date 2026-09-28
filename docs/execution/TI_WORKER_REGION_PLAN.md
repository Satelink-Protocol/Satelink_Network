# FG-TI-REGION — move ONLY the Trading Intelligence refresh worker out of the US

Status: **PREPARED — BLOCKED on counsel** (MARKET_DATA_TERMS.md question 5: is a non-US worker permissible, or circumvention?). Not executed. Written 2026-09-28. Legal context: `docs/legal/MARKET_DATA_TERMS.md`.

## Today (verified 2026-09-28, `railway status --json`)
- Every Railway service is in **`us-west2`** (California): `Satelink-api`, `Postgres-iQeW`, `Redis`, `satelink-reconciler`, Paperclip.
- The TI refresh is **in-process in the API**: `app_factory.mjs:434` → `startIntelRefresh()` (`intelligence/engine.js:195`),
  gated by `INTEL_REFRESH_ENABLED=true`, every `INTEL_REFRESH_MS` (default 120 s), freshness window `INTEL_FRESHNESS_SEC` (300 s).
  It fetches venue market data and writes `intelligence_snapshots`; the API serves `/v1/intelligence/*` from that table.
- Binance and Bybit answer **451/403 to US IPs**; #445 switched to venues that serve a US-hosted API.

## Target
A second Railway service **`satelink-intel-worker`** (same repo, same image) in **`europe-west4`** (Netherlands) —
or `asia-southeast1` (Singapore) — that runs only the refresh loop. The API keeps serving from `us-west2` and stops
refreshing. Nothing else moves: no DB, no Redis, no API region change.

Region choice: **EU (europe-west4) proposed**, Singapore as the alternative. Which venues restrict which jurisdictions
is summarised (with sources) in `docs/legal/MARKET_DATA_TERMS.md`; pick the region only after reading it — **counsel must
confirm** before either region is used for commercial redistribution. A region change fixes the IP geo-block only; it
does not settle the licence question for redistributing derived data.

## Code needed (one small PR, non-money, prepared on approval)
`apps/api/scripts/intel_worker.mjs`:
```js
// Standalone TI refresh worker (FG-TI-REGION). Runs ONLY the refresh loop.
import pg from 'pg';
import { startIntelRefresh } from '../src/intelligence/engine.js';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
process.env.INTEL_REFRESH_ENABLED = 'true';
startIntelRefresh(pool, { logger: console });
setInterval(() => {}, 1 << 30); // the refresh timer is unref()'d — keep the process alive
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => pool.end().finally(() => process.exit(0)));
```
No HTTP server, no scheduler, no settlement — nothing else from `server.js` boots.

## Steps (founder)
1. Merge the worker PR (non-money).
2. Railway → project → **New service** → GitHub repo `Satelink_Network`, branch `main`, name `satelink-intel-worker`.
   Settings → Deploy → **Custom start command** `node apps/api/scripts/intel_worker.mjs`; Region **europe-west4**;
   Replicas 1; no public domain; no healthcheck path.
3. Variables: `DATABASE_URL=${{Postgres-iQeW.DATABASE_URL}}` (private network — Railway private networking spans
   regions within a project environment; if it does not resolve, use `DATABASE_PUBLIC_URL`), plus any `INTEL_*` source
   keys the connectors read (copy by name from `Satelink-api`).
4. Watch logs for `[Intel] refresh: N/4 metrics updated (…)` — per-venue status codes are informational; venues whose terms bar the use stay disabled until counsel answers (FG-TI-LEGAL).
5. Then on the API: `railway variables --service Satelink-api --set INTEL_REFRESH_ENABLED=false` (restart) — exactly one
   writer. Rollback: set it back to `true` and stop the worker service.

## Verification (I run after each step)
- `SELECT metric, max(created_at) FROM intelligence_snapshots GROUP BY 1` advances every ~2 min from the worker.
- API logs no longer show `[Intel] refresh` lines after step 5.
- `GET /v1/intelligence/<metric>` with a founder key → 200 with `freshness` < 300 s; charged 10 UU / $0.01 once.

## Cost (estimate — confirm on Railway's pricing page)
Railway bills usage: roughly $20 / vCPU-month and $10 / GB-month RAM (Pro), plus egress. The loop is idle between
2-minute ticks: ~0.05 vCPU average and ~120 MB RAM ≈ **$1–3 / month** + egress for ~4 venue fetches every 2 min
(well under 1 GB/month) + cross-region Postgres traffic (a handful of small INSERTs per tick; negligible).

## Latency
- Venue fetch from EU: Binance/Bybit/OKX API edges are fronted by CDNs with EU POPs → typically 20–80 ms vs today's
  blocked/US paths.
- Worker → Postgres (us-west2) writes: ~140–160 ms RTT EU↔US-West per round trip; a tick does a few writes → < 1 s
  added per 120 s cycle. **No effect on API request latency**: the API still reads `intelligence_snapshots` in-region.
- Singapore alternative: ~170–190 ms to us-west2; similar conclusions.

## Risks
- Two writers if step 5 is skipped (harmless duplicates, but wasteful) → step 5 is part of the gate.
- Worker crash = stale data → `freshness` exceeds 300 s and TI answers 503 `warming_up` uncharged (existing #429 rule).
  D7 alert on snapshot age recommended.
