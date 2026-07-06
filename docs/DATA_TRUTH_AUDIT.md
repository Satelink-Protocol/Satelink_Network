# Data Truth Audit — Satelink Dashboards

**Date:** 2026-07-06 · **Auditor:** Phase 0 of `ui/finished-dashboard` · **DB:** production Postgres (`Postgres-iQeW`, read-only queries) · **API:** live `api.satelink.network`

Scope: every metric rendered on the **admin command center** (`/admin/command-center`, all tabs) and the **developer portal** (`/satelink/os/*`: Mission Control, API Keys, Credits & Deposits, Usage, Monitoring). Verdicts: **TRUE** (matches a real SQL/on-chain source, honestly labeled) · **FALSE** (number is wrong, mislabeled, or fabricated) · **UNVERIFIABLE** (no backend exists).

---

## 1. The verdict table

| # | Metric (screen) | Displayed value | Source endpoint | Backing SQL / source | Verdict |
|---|---|---|---|---|---|
| 1 | Lifetime Revenue (admin Executive) | $0.00015 | `GET /admin/executive/summary` → `revenue_mtd_usdt` | `SUM(amount_usdt) FROM revenue_events_v2 WHERE NOT is_test_data` | **FALSE (mislabeled)** — sum is correct, but **$0.00003 of it is the treasury's own API key** (internal usage). External-only revenue is **$0.00012**. Field is also named `_mtd_` while being a lifetime sum. |
| 2 | Total Requests (24h) (admin Executive, Mission Control) | 453.4K → live 425,866 | `GET /admin/executive/summary` → `total_requests_24h` | `SUM(calls_today) FROM developer_intel` | **FALSE** — `calls_today` is never zeroed for IPs that go quiet. 345,827 of 424,919 calls (81%) belong to IPs not seen in 24h. Honest 24h number: **~64,016** (Redis `ft:*` counters, resets UTC midnight) or 79,092 (`last_seen >= now()-24h`). |
| 3 | Active IPs (24h) (admin Executive, Mission Control) | 21.7K → live 20,294 | `GET /admin/executive/summary` → `active_ips_24h` | `COUNT(*) FILTER (WHERE calls_today>0) FROM developer_intel` | **FALSE** — 16,186 of 20,279 counted IPs were last seen more than 24h ago. Honest number: **3,046** (Redis) / 4,093 (`last_seen` filter). |
| 4 | Paying Customers (admin Executive) | 2 | `GET /admin/executive/summary` → `paying_customers` | `COUNT(*) FILTER (WHERE total_deposited>0) FROM api_credits` | **FALSE (unlabeled)** — one of the two is the treasury self-deposit (`0x966e…7ad4`, $0.59993). Truth: **1 external** (`0x5cbd…fa97`, $5.00 on 2026-07-05) **+ 1 internal**. |
| 5 | Network Health (admin Executive) | 100% | `GET /admin/executive/summary` → `network_health_pct` | `node_health_logs`, 24h healthy fraction | **FALSE (vacuous)** — 721/721 healthy samples from **a single node** (the gateway's own self-heartbeat). Ignores SIGNER_UNFUNDED, 1,954 blocked batches, DRY_RUN. Cannot honestly read 100%. |
| 6 | Signer Gas Balance (admin Executive) | — / null | `GET /admin/executive/summary` → `signer_balance_pol` | `SettlementControl.getStatus()` (on-chain read) | **TRUE** — `null` is honestly surfaced; "Unfunded" badge however only renders when the value is `0`, not `null` (UI bug). |
| 7 | Open Alerts (admin Executive) | 19 | `GET /admin/executive/summary` → `open_alerts` | `COUNT(*) FROM gas_alerts WHERE alerted_at >= now()-24h` | **TRUE** (psql: 18–19, moving window). |
| 8 | Executive alert strip | 4 static alerts | none — **hardcoded in `page.tsx:444-452`** | none | **FALSE (fabricated)** — the endpoint returns live `top_risks`; the UI ignores it and renders a hardcoded list incl. the literal string "1954 blocked_unfunded settlement batches". |
| 9 | System Status list (admin Executive) | API/RPC/DB/Redis "operational" | none — **hardcoded in `page.tsx:474-478`** | none | **FALSE (fabricated)** — 4 of 5 rows are string literals; only Polygon is derived from data. Real db/redis probes exist at `/admin/observability/metrics`. |
| 10 | Gateway Traffic chart (admin Executive) | area chart "requests over time" | none | `developer_intel.avg_daily_calls` per lead, re-timestamped `Date.now()-i*3600000` | **FALSE (fabricated)** — per-lead averages disguised as an hourly time series. No request-history endpoint exists. |
| 11 | Blocked Unfunded batches (admin Treasury) | 1,954 / $294.29 | `GET /admin/treasury/status` | `SELECT status, COUNT(*), SUM(total_amount_usdt) FROM settlement_batches GROUP BY status` | **TRUE** — psql: 1,954 blocked_unfunded ($294.292818), 98 confirmed ($14.775408), 1 pending ($0.150516). UI lacks the one-sentence explanation of what unblocks them. |
| 12 | Merkle Proof Integrity panel (admin Treasury) | "verify roots" → root hash | none | `setTimeout(1200ms)` + literal string `0x98fca327dbbf43702a…1298d` | **FALSE (fabricated)** — pure theater, incl. a fake "Sign On-Chain Settlement" button. Removed. |
| 13 | Revenue Control KPIs (admin) | $0.00015 / counts | `GET /admin/revenue/summary` | `revenue_events_v2` aggregates with `is_test_data` filters | **TRUE** (5 real events = $0.00015; 2 test events correctly excluded) — external/internal split added per #1. |
| 14 | Revenue Funnel "Cumulative Calls" (admin) | 425K | `GET /admin/revenue/funnel` → `requests_24h` | `SUM(calls_today) FROM developer_intel` | **FALSE** — same stale-counter defect as #2. |
| 15 | Demand Radar "Total Active IPs" (admin) | 55,129 | `GET /admin/demand/stats` → `total_active_ips` | `COUNT(*) FROM developer_intel` | **FALSE (mislabeled)** — that is every IP ever recorded, not active ones. Renamed `total_tracked_ips`; fresh actives reported separately. |
| 16 | Demand Radar class counts (admin) | machine 36,264 / developer 2,871 / … | `GET /admin/demand/stats` | `GROUP BY classification` | **TRUE** (psql matches). |
| 17 | Network tab Availability/p50/Error (admin) | 100% / ~49ms / 0% | `GET /admin/network/health` | `node_health_logs` 24h | **TRUE but must be labeled** — sample is 1 self-heartbeat node. `requests_24h` in same payload has defect #2. |
| 18 | Nodes list (admin) | 1 active node | `GET /admin/nodes/list` | `SELECT … FROM registered_nodes` | **TRUE**. |
| 19 | Billing & Credits (admin) | 17 keys, $5.60 dep | `GET /admin/billing/credits` | `api_credits` aggregates + `credit_deposits` | **TRUE** (psql: deposits 5.0 + 0.5 + 0.1). |
| 20 | Incidents (admin) | 3 incidents | `GET /admin/incidents` | static list, **labeled** `source: STATIC` | **TRUE** (honestly labeled as static historical record). |
| 21 | Mission Control "Real Revenue" (portal) | $0.00015 | `GET /api/financial/truth` → `metered_value_usdt` | `SUM(amount_usdt) FROM revenue_events_v2` | **TRUE** (matches psql; self-documenting `sources` block in payload). |
| 22 | Mission Control requests/IP cards (portal) | 425.9K / 20.3K | `/admin/executive/summary` via proxy | same as #2/#3 | **FALSE** — inherits defect #2/#3; fixed at the API. |
| 23 | Mission Control RPC provider status + cache (portal) | per-provider circuit state | `GET /rpc/stats/polygon` (public) | gateway in-memory circuit breakers | **TRUE** (live curl verified). |
| 24 | Monitoring "Requests (24h)" (portal) | 64,015 | `GET /api/status` → `total_requests_24h` | Redis `ft:*` counters (`getFreeTierStats()`) | **TRUE** — but the label should say "since UTC midnight". |
| 25 | Monitoring "99.5% uptime" caption + "Avg Latency 85 ms" (portal) | 99.5% / 85 ms | `GET /api/status` | **hardcoded** `app_factory.mjs:226,230` (and in the catch-fallback :238,242) | **FALSE (fabricated)** — constants. Replaced with real `node_health_logs` availability/p50; `null` when unknown. |
| 26 | Monitoring "Nodes Online 1", epoch, Vault $5 (portal) | 1 / 51212 / $5.00 | `/api/status`, `/api/treasury/status` | `registered_nodes`+`nodes`, `epoch_ledger`, on-chain vault read | **TRUE** (vault balance matches the 5 USDT deposit). |
| 27 | Monitoring Grafana panels ×11 (portal) | dead iframes | `/api/grafana/*` proxy | requires `GRAFANA_URL`/`GRAFANA_TOKEN` — **Grafana not deployed** | **UNVERIFIABLE → removed** — replaced with a single honest EmptyState until Grafana ships. |
| 28 | Keys page "Revenue Impact" (portal) | `$(spend×1.2)` | none | `totalSpendingToday * 1.2` in `keys/page.tsx:132` | **FALSE (fabricated)** — invented multiplier. Replaced with real "Credits Remaining" (sum of per-key `credits_remaining` from `/api/keys/usage`). |
| 29 | Keys page "Keys Near Limit" / "Spending Today" (portal) | derived | `GET /api/keys/usage` per key | `api_credits` + Redis per-key counters | **TRUE** (derived from real per-key usage). |
| 30 | Keys page "Alerts" card (portal) | 0/1 | none (local derivation of #29) | — | **FALSE (no backend)** — an "alert" that exists only as a ternary in the component. Removed in favor of the real near-limit count. |
| 31 | Keys page Access Rules modal (portal) | "Save Rules" | none | `alert("Gateway access rules updated.")` | **FALSE (fabricated action)** — no endpoint. Removed until a real budget-cap API exists. |
| 32 | Free Tier Limits panel (portal keys) | 500/day, $0.00003 | static product spec, labeled "Reference — static tier spec" | env `FREE_TIER_LIMIT` | **TRUE** (honestly labeled constants, matches `/stats/free-tier` limit + `PRICE_PER_CALL`). |
| 33 | Credits & Deposits page (portal) | estimator, calldata, history | `GET /credits/initiate`, deposit history polling | real ABI calldata + `credit_deposits` | **TRUE** (PR #232/#233 flow; estimator is arithmetic on the real $0.00003 rate). |
| 34 | Usage page charts (portal) | per-key series | `/api/keys/usage` + history endpoints | per-key metering tables | **TRUE** (renders only fetched rows; honest empty state when none). |

Also audited: `components/deposit/NetworkStatsWidget.tsx` is imported by no page (dead code) — not counted as a displayed metric.

---

## 2. Evidence (psql, production)

### Lifetime revenue + internal/external split (#1, #13)
```
 real_events | lifetime_real_usdt
-------------+--------------------
           5 |         0.00015000

                        client_id                         |     source      | is_test_data | count |    sum
----------------------------------------------------------+-----------------+--------------+-------+------------
 sk_free_61c987ad…735677 (wallet 0x5cbd…fa97, EXTERNAL)    | edge_cache      | f            |     2 | 0.00006000
 sk_free_61c987ad…735677 (wallet 0x5cbd…fa97, EXTERNAL)    | alchemy-polygon | f            |     2 | 0.00006000
 sk_free_7a608c4a…3d6309 (wallet 0x…dEaD, TEST)            | edge_cache      | t            |     2 | 0.00006000
 sk_live_f6d9bef0…74135a (wallet 0x966e…7ad4, TREASURY)    | alchemy-polygon | f            |     1 | 0.00003000
```
→ Real external = **$0.00012**, internal (treasury key) = **$0.00003**, test correctly flagged.

### Stale `calls_today` counters (#2, #3, #14)
```
SELECT COUNT(*) FILTER (WHERE calls_today>0), SUM(calls_today) FROM developer_intel;
 active_ips | total_calls
------------+-------------
      20279 |      424919

-- freshness split (calls_today > 0):
 seen_24h | stale | calls_fresh | calls_stale
----------+-------+-------------+-------------
     4093 | 16186 |       79092 |      345827
```
Writer: `ip_classifier.js:237-270` only overwrites `calls_today` when an IP reappears in the Redis counters; absent IPs keep their last count forever. Redis ground truth (`GET /stats/free-tier`): `{"activeIPs":3046,"totalCalls":64016,"nearLimitIPs":29,"limit":500}`.

### Classification breakdown of "traffic" (#2)
```
 classification |  ips  | active_ips | calls
----------------+-------+------------+--------
 unknown        | 15991 |      15989 | 330857
 developer      |  2871 |       2871 |  46397
 machine        | 36264 |       1416 |  30772
 scanner        |     3 |          3 |  16893
```
79% of the summed calls are "unknown" traffic; 3 scanner IPs alone contribute 16,893 calls.

### Paying customers (#4)
```
               wallet_address               | tier  | total_deposited | total_spent | credits_usdt
--------------------------------------------+-------+-----------------+-------------+--------------
 0x5cbda3a1c0f1b28fecea1d919785321e88f9fa97 | basic |        5.000000 |    0.000120 |     4.999880   ← EXTERNAL (2026-07-05)
 0x966e1ae22996545015b1414b35234b10719d7ad4 | basic |        0.599930 |    0.000060 |     0.599870   ← TREASURY (internal)
```

### Network health sample (#5, #17)
```
 health_pct | samples | nodes
------------+---------+-------
     100.00 |     721 |     1
```
One node = the gateway's own self-heartbeat. 100% describes nothing about the platform while `signer_balance_pol=null`, `SETTLEMENT_DRY_RUN=1`, and 1,954 batches are blocked.

### Settlement batches (#11)
```
      status      | count |    usdt
------------------+-------+------------
 blocked_unfunded |  1954 | 294.292818
 confirmed        |    98 |  14.775408
 pending          |     1 |   0.150516
```
Meaning: epochs were aggregated into payable batches, but the settlement signer (`0x988f…`) has no POL for gas, so nothing can broadcast. Unblock: fund the signer (and keep `SETTLEMENT_DRY_RUN=1` until real external metered revenue > $0.50).

### Hardcoded /api/status values (#25)
`apps/api/app_factory.mjs:226` `uptime_pct: 99.5,` and `:230` `avg_latency_ms: 85,` (repeated in the error fallback at `:238`/`:242`) — constants in both the success and failure paths.

### Live API cross-checks
```
GET /api/financial/truth   → metered_value_usdt: 0.00015           (matches psql)
GET /api/status            → total_requests_24h: 64015 (Redis)     uptime_pct: 99.5 (hardcoded)
GET /stats/free-tier       → {"activeIPs":3046,"totalCalls":64016,"nearLimitIPs":29,"limit":500}
GET /api/treasury/status   → vault_balance_usdt: 5, total_deposited_usdt: 5.6, active_wallets: 2
GET /admin/executive/summary → active_ips_24h: 20294, total_requests_24h: 425866,
                               network_health_pct: 100, paying_customers: 2   (defects #2-#5, live)
```

---

## 3. Fixes applied (API layer — queries corrected, not hidden)

| Defect | Fix | File |
|---|---|---|
| #1 revenue unlabeled internal share | `revenue_external_usdt` / `revenue_internal_usdt` split by joining `revenue_events_v2.client_id` against treasury-owned keys in `api_credits` | `apps/api/src/admin/admin_router.js` (`/executive/summary`, `/revenue/summary`) |
| #2/#3/#14/#15/#17 stale 24h numbers | All "24h" aggregates now filter `last_seen >= now()-interval '24 hours'`; executive summary prefers the Redis counter (`getFreeTierStats()`) with the DB filter as fallback; payloads carry `requests_source` so the UI can label the window | same file |
| #4 paying customers | `paying_customers_external` / `paying_customers_internal` (treasury wallet excluded from external) | same file |
| #5 health score | `network_health_pct` = node availability − 30 (signer unfunded) − 20 (blocked batches) − 10 (DRY_RUN), clamped ≥ 0, with `health_components` in the payload for the UI tooltip. Current truthful value: **40%** | same file |
| #25 hardcoded uptime/latency | `/api/status` computes `uptime_pct` and `avg_latency_ms` from `node_health_logs` (24h availability, p50); returns `null` when unknown instead of a fake constant | `apps/api/app_factory.mjs` |
| #8 hardcoded alert strip | UI renders `top_risks` from the endpoint | `apps/web/.../admin/command-center/page.tsx` |
| #9 hardcoded system status | wired to `/admin/observability/metrics` (db/redis probes) + settlement state; no literal "operational" strings | same file |
| #10 fabricated traffic chart | replaced with honest empty state ("No request-history endpoint yet") | same file |
| #12 fake Merkle panel | removed | same file |
| #28/#30/#31 fabricated keys-page items | "Revenue Impact" → real "Credits Remaining"; "Alerts" card removed; fake Access-Rules save removed | `apps/web/.../keys/page.tsx` |
| #27 dead Grafana iframes | section gated behind a live probe of `/api/grafana` config; EmptyState when unconfigured | `apps/web/.../monitoring/page.tsx` |

**Post-fix verification is in §4 (re-run after Phase 4).**

## 4. Post-fix verification — 2026-07-06 (Phase 0)

Fixed handlers exercised against **production Postgres** via a router-only harness
(admin router mounted standalone, `redis=null` so the DB fallback path is what ran;
in production the Redis `ft:*` source takes precedence and reports the smaller
UTC-day window, cf. `/stats/free-tier` = 64,016 calls / 3,046 IPs). Actual output:

```
/admin/executive/summary →
  revenue_lifetime_usdt: 0.00015   revenue_external_usdt: 0.00012   revenue_internal_usdt: 0.00003
  total_requests_24h: 81193        active_ips_24h: 4147
  requests_source: "developer_intel_last_seen_24h" (harness; prod prefers "redis_utc_day")
  paying_customers_external: 1     paying_customers_internal: 1
  network_health_pct: 40
  health_components: { node_availability_pct: 100, node_sample_count: 1,
                       signer_unfunded: -30, blocked_batches: -20, dry_run: -10 }
  top_risks: 4 entries, each with an `unblock` condition string

/admin/revenue/summary → external_usdt: 0.00012, internal_usdt: 0.00003, real 5 / test 2 events
/admin/demand/stats    → total_active_ips: 4147 (was 55,149 mislabeled), total_tracked_ips: 55149,
                         top_lead_ip now restricted to last_seen ≥ 24h (95.217.88.113, 940 calls/d)
/admin/network/health  → availability_pct: 100 with availability_sample_nodes: 1 (labeled),
                         p50_latency_ms: 61, requests_24h: 81193
/api/status health SQL → uptime: 100 (measured, 1-node sample), p50: 61ms
                         (previously hardcoded 99.5 / 85)
```

Every FALSE verdict in §1 is now either corrected at the query (#1–#5, #14, #15, #17, #25)
or removed/replaced with an honest empty state in the UI (#8, #9, #10, #12, #27, #28, #30, #31).
Zero UNVERIFIABLE metrics remain. Re-run scheduled again at the Phase 4 QA gate.
