# 2026-08-27 — Legacy revenue writer (WS storm) + edge rate-limit

Follow-up to the volume-exhaustion incident. Two questions: did the Aug-22 write storm
*stop* or was it *suppressed*, and what writer produced it. Both answered with psql.

## 1. Cliff or taper? — VERDICT: CLIFF (suppression, not organic stop)

`revenue_events_v2` / `ledger_entries` daily (21-day window):

| day | rev2 rows | ledger rows |
|---|---:|---:|
| 2026-08-16 | 1,979 | 3,958 |
| 2026-08-17 | 2,334 | 4,668 |
| 2026-08-18 | 53,502 | 106,992 |
| 2026-08-19 | 53,234 | 106,462 |
| 2026-08-20 | 10 (all `not_ok`) | 0 |
| 2026-08-21 | 0 | 0 |
| 2026-08-22 | 234,780 | 469,224 |
| 2026-08-23 … 08-27 | **0** | **0** |

Aug-22 **hourly**: 08:00 → 11,947 · 09:00 → 111,581 · 10:00 → 99,762 · 11:00 → 11,490 →
**hard stop at 11:06:11**. Writing 100k+/hour, then an abrupt mid-hour cliff — not a taper.
Last write for BOTH tables: `2026-08-22 11:06:11`.

**Cross-reference (Phase 1.2):** inbound traffic is **670,430 req/24h right now** (heavier than
the 496k historical) while writes have been **zero for 5 days**. Requests continuing + writes
stopping = the writes stopping was NOT traffic stopping = **suppression** (the 1 GB volume filled
and Postgres rejected the INSERTs). The volume is now 5 GB / 4.4 GB free, so **the storm can
resume** unless the writer is gated. It is a live risk.

## 2. Legacy writer reachability — and a correction to the stated context

**op_type distribution (empirical — maps every row to its writer):**

| op_type | rows | amount | window | writer |
|---|---:|---|---|---|
| `ws_subscription` | **345,820** | $0.000001 | 08-16 → 08-22 | `ws_gateway.js:223` |
| `rpc_call` | 64 | $0.00003–$0.10 | 06-22 → 08-20 | `rpc_billing.js:88` |

**Correction (psql wins):** the storm did NOT come from `operations_engine.js` /
`security/middleware/billing.js` (the "?-placeholder" code named in the brief). Those wrote
**zero** rows. **100% of the storm is `ws_subscription` from the WebSocket gateway.**

### Reachability table

| writer | file:line | trigger | reachable from live route? | proof |
|---|---|---|---|---|
| **WS gateway** | `ws_gateway.js:223` | 1 row per streamed `eth_subscription` event | **YES — and unauthenticated** | mounted `server.js:15`; upgrade handler accepted ANY `/rpc/ws/*` with no auth check (fixed in this PR) |
| rpc billing | `rpc_billing.js:88` | paid rpc call, `amountUsdt>0` guard | yes | today's `/rpc` path; guarded |
| x402 settlement | `x402/settlement.js:108` | on-chain x402 deposit | yes | legit deposits |
| oracle / ai_gateway / webhooks / bandwidth_proxy / mev_relay | workloads/* | per workload call | mounted, but **0 rows ever** | not in op_type distribution |
| operations_engine / security-billing | `?`-placeholder SQL | — | **no rows ever** | never in op_type distribution → dead |
| node_dispatcher / global_gateway_router / job_dispatcher | — | — | no entrypoint import | absent from `app_factory.mjs`/`server.js` |

**Root cause:** `createWsGateway`'s upgrade handler (`ws_gateway.js:46`) accepted any WS connection
on `/rpc/ws/*` with **no credential check**. An anonymous client subscribing to Polygon
`newPendingTransactions` (a firehose) triggered `recordWsRevenue` — one `revenue_events_v2` row
(+ shadow ledger) **per event**, unconditionally. That is the 100k+/hour storm.

## 3. Fixes shipped in this PR

- **`ws_gateway.js`**: the WS upgrade now requires the same credential as HTTP `/rpc` —
  `x-api-key`/`x-wallet-address` header OR `?api_key`/`?token` query (browser WS clients cannot
  set headers). Unauthenticated upgrades get `401` and are destroyed before any subscription
  opens → no connection, no writes. (x402 discovery is HTTP-only, so this 401 never touches the
  paid path — STOP-B not implicated.) Unit test: `test/ws_gateway_auth.test.js` (7 passing).
- **DB backstop — migration 015** (applied to prod): `CHECK (is_billable = false OR
  (amount_usdt IS NOT NULL AND amount_usdt > 0))`. A row marked billable must carry a positive
  charge — no future code path can insert a `$0` billable phantom. **Proven**: a `$0`/billable
  INSERT is rejected. **Limit (honest):** this does NOT catch the ws storm (its rows were
  `$0.000001 > 0`); the storm is prevented by the WS auth gate. A CHECK constraint cannot
  rate-limit micro-charges from an unauthenticated firehose.

## 4. Edge rate-limit — Free plan, dashboard-only (see docs/ops/cloudflare-rpc-ratelimit.md)

Zone `satelink.network` is **Cloudflare Free**, which caps `http_ratelimit` at **1 rule**
(API returned `50001: 2 out of 1` when adding a second). One rule already exists
(10 req/10s per-IP on api/rpc hosts, excl. `/admin/`) — STOP-B-safe but too lenient (a 12-request
burst was not blocked in testing). The targeted 5/60s header-aware rule cannot be added via API;
exact dashboard steps + ready-to-paste expression are in `docs/ops/cloudflare-rpc-ratelimit.md`.

**STOP-B verification (current edge):** unauthenticated single `/rpc/base` → **402** (app x402
discovery, NOT a CF 403); `/health` → 200. x402 discovery intact.

## 5. Baseline for comparison (Phase 4.1)
- cpu_pct **0.23** · memory **201.8 MB** · requests_24h **670,430** · p50 **85.5 ms** (2026-08-27).
- Egress benchmark (Railway usage page): **34.98 GB / 17 days ≈ 2.06 GB/day**. Re-check 2 h / 24 h
  after the edge rule + WS gate deploy.

## 6. Projected row growth after fixes
WS storm writer gated + billing guard + free-tier removal (PR #340) → money-path writes only on
authenticated + paid calls (of which there are none today). **~469,000 rows/day peak → ~0/day.**
