# Migration Plan

> How the live system becomes the vNext system without a rewrite, an outage, or a deleted byte. Strategy: **strangler pattern, additive-only in Phase 1**, physical archive moves deferred and gated.

## Guiding constraints (from the audit)

- The live app earns attention (496k req/day) even though it earns ~no money — breaking it destroys the demand-discovery pool and the deploy pipeline confidence for zero benefit.
- Deploys ship only via merge-to-main → Railway/Vercel auto [measured]. There is no staging environment. Therefore every migration step must be individually shippable and individually revertible.
- Test baseline 128/9 is the regression tripwire (Rule #10).
- Local full-app boot writes to prod DB (scheduler + anchor) — verification of new routers happens by loading only the router against read-only prod Postgres, the method proven on the observer-wiring branch [memory].

## Step 0 — Namespace (this PR)
`docs/vNext/` created. No code.

## Step 1 — Additive core (Phase 1 code PRs, each small)
1. `apps/api/src/vnext/` directory: interfaces, spread ledger DAO, route log DAO.
2. New tables via migration files (`vnext_*` prefix): `vnext_suppliers`, `vnext_resources`, `vnext_quotes`, `vnext_route_log`, `vnext_spread_ledger`, `vnext_supplier_scores`. Additive; legacy 32 tables untouched (Rule #7).
3. Mount `/x/` (resale surface) and `/vnext/admin/` in `app_factory.mjs` — two new lines, no existing line modified.
4. Outbound payer: new module + dedicated wallet + caps + `VNEXT_OUTBOUND_ENABLED=false` default. Ships dark.
5. Crawler + probe jobs registered in the existing cron host, behind `VNEXT_CRAWL_ENABLED=false` default. Ships dark.
6. Enable flags one at a time (human flips, per Rule #6): crawl → shadow routing (Shadow rail, no money) → outbound with minimum caps → M1 attempt.

Rollback for any step: flag off, or revert the PR. No step depends on a legacy file changing.

## Step 2 — Demotion by disuse (Phase 2)
- Self-supplied RPC continues at `/rpc` unchanged; the same capacity is *also* listed as concrete `/x/rpc-*` resources. Traffic tells us when the legacy surface can freeze.
- Archive-class enforcement (import lint, H-3) turns the classification into a compile-time fact.
- H-2 measurement: request counts per mounted experiment (`defi_gateway`, `bridge_gateway`, `bandwidth_proxy`, `oracle`, `mev_relay`) over 30 days. Zero-traffic mounts get a dated OBSOLETE entry and their flag-off plan.

## Step 3 — Physical archive (Phase 2/3, gated)
Only after M1 passes and H-2 data exists:
1. `git mv` orphan roots (top-level `src/`, `core/`, `services/`, `agents/`, `utils/`, stub `app_factory.mjs`, `server.shim.current.js`) → `archive/legacy-roots/` in one reviewed PR. `git mv` preserves history; nothing is deleted (mandate). CI + boot must stay green — these are unimported [verified], so risk is confined to stray dynamic requires; grep for dynamic paths first.
2. Archive-class files inside `apps/api/src` move **only** when their last live import is gone; tracked per-file in the archive manifest. No bulk sweep (the repo's own SECURITY.md records why blanket sweeps were rejected — unreviewable).
3. Docs are never moved (Rule #8); `LEGACY_MAP.md` is the only index.

## Step 4 — Second rail (Phase 3)
`erc20-polygon` RailAdapter (USDT + RevenueVaultV2). Legacy epoch/anchor path retires only when the vNext rail covers its one real function (receiving deposits), and only via founder decision — `SETTLEMENT_DRY_RUN` remains sacred until then (Rule #3).

## Explicit non-migrations
- No monolith split. Extraction is a Phase-3+ decision taken only under measured load pain.
- No DB re-architecture. 304 MB / 32 tables is small; new tables suffice.
- No frontend migration. `apps/web` is out of the money path.
- No rewrite of `utils/` (227 files): vNext simply doesn't import unread code.

## Failure honesty
If flag-enable of any Step-1 stage regresses the baseline or the live `/rpc` p50, the flag goes off the same day and the failure is recorded in `../04_EXECUTION/CHECKLIST.md` before any retry.
