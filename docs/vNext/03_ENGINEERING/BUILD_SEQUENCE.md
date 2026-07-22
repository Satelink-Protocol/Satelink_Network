# Build Sequence

> Strict order of construction. Each item is one shippable PR (or a small stack), sized for this team (one founder + agents), with its verification method. No item starts before its predecessor merges — the sequence *is* the dependency graph.

## Phase 1 — the spread loop (target: M1)

| # | Item | Contents | Verify by |
|---|---|---|---|
| B-1 | Schema + DAOs | `vnext_*` tables (suppliers, resources, quotes, route_log, spread_ledger, scores), append-only ledger DAO with `CHECK (spread >= 0)`, `is_test_data` columns | migration applies on prod-schema copy; unit tests; baseline stays 128/9 |
| B-2 | Rail `x402-base` inbound wrap | thin adapter over existing `payments/x402/` exposing the RailAdapter interface; zero behavior change to `/rpc` | existing x402 tests still pass; curl 402 challenge unchanged |
| B-3 | Outbound payer | port x402-kit client → `RailAdapter.payOut`; dedicated wallet; caps (per-payment/hour/day/floor) enforced before signing; idempotency by (request, supplier); `VNEXT_OUTBOUND_ENABLED=false` | Shadow-mode test (sign, don't broadcast) + one $0.001-class live payment to a founder-controlled x402 endpoint, flagged test-data |
| B-4 | Bazaar crawler + probe | cron job: fetch facilitator discovery list → normalize → upsert `vnext_suppliers`; free probes; record S-1 metric (total listings count, dated) | run against live facilitator read-only; suppliers table populates; `VNEXT_CRAWL_ENABLED` flag |
| B-5 | Router v1 + resale surface | `/x/<slug>` mount: quote (Pricing formula) → 402 → settle-in → route (eligibility filter + argmax) → pay-out → execute → ledger write; per-adapter kill switch | end-to-end in Shadow rail; then live self-supply resource; chaos assertions T5-lite |
| B-6 | Concrete discovery listings | replace wildcard `/rpc/:var1` listing with concrete `/x/*` resources, method-level descriptions (PR #257 pattern); two-margin A/B slugs (P-1) | facilitator lists N concrete resources for payTo [check via discovery/resources] |
| B-7 | **M1 execution** | pick 1 probed external supplier; enable outbound at minimum caps; first spread event; verify txs on-chain by hand | T3 pass (first non-founder event) — see `../04_EXECUTION/PHASE_1.md` |
| B-8 | Spread observability | `/vnext/admin/spread` read-only endpoints; wire to truthful dashboard; EmptyState at zero | curl against prod; numbers reproducible from ledger SQL |

Parallelizable: B-4 with B-2/B-3. Everything else is ordered.

## Phase 1 hygiene (interleaved, never blocking the money line)

| # | Item |
|---|---|
| H-1 | File-level pass over `apps/api/src/{gateway,core}` — live/dead marking into the archive manifest |
| H-2 | 30-day request-count measurement per experimental workload mount |
| H-3 | Import lint: vnext code cannot import archive-class paths (manifest-driven CI check) |

## Phase 2 — generalize (after M1 + T4 pass)

| # | Item |
|---|---|
| B-9 | Supplier scoring v1 (Reputation Engine windows) + breaker port; router uses scores |
| B-10 | Multi-resource resale: top-K probed Bazaar resources listed automatically under policy (margin, category allowlist, resale-permissive only) |
| B-11 | Failover semantics (paid-retry budget, loss-avoided events) + T5 full chaos drill |
| B-12 | Zero-touch week instrumentation (deploy-freeze audit) → T6 attempt |
| B-13 | Archive Step-3 physical moves (per MIGRATION_PLAN gates) |

## Phase 3 — rail independence + next adapter

| # | Item |
|---|---|
| B-14 | `erc20-polygon` RailAdapter (USDT/RevenueVaultV2 inbound; plain-transfer outbound with confirmation watch) |
| B-15 | First non-RPC workload adapter — whichever rejection-log trigger fires first (watchlist: AI inference, search) |
| B-16 | Router v2 (bounded exploration; only if ≥1,000 routed real units exist) |

## Sizing honesty

Phase 1 total is deliberately small: B-1..B-8 is on the order of a few thousand lines against interfaces that already half-exist [code: x402 merchant stack, ISettlementAdapter, cron host, credits path]. The historical failure mode of this repo is building B-9..B-16-class ambition before B-7-class proof (48 workload files, 27 economics files, ~$0 revenue [audit]). The sequence exists to prevent exactly that: **nothing after B-8 starts until a real spread event exists.**
