# Repository cleanup manifest — 2026-10-07

Base: `origin/main` @ `bdb52ecf`. Recovery: tag **`archive/pre-cleanup-2026-10-07`** (pushed) holds the full pre-cleanup tree —
`git checkout archive/pre-cleanup-2026-10-07 -- <path>` restores any file.

## Deploy path (what must never break)

| Target | Config | Entry |
|---|---|---|
| Railway `Satelink-api` | service `rootDirectory=/apps/api` → `apps/api/railway.json:7` (`node server.js`), `apps/api/nixpacks.toml` | `apps/api/server.js` |
| Railway `satelink-reconciler` | `workers/reconciler/railway.json:7` | `@satelink/reconciler` |
| Railway `Satelink_Paperclip` (FAILED) | `railway.paperclip.json` → `Dockerfile.paperclip`, `start-cloud.sh` | — |
| Vercel web / console / corporate | `apps/web/vercel.json`, `apps/console/vercel.json`, corporate project | `next build` |
| CI | `.github/workflows/ci.yml` (turbo test web, `scripts/ci-baseline-check.sh`, web build), `architecture.yml` | — |

Static + dynamic import walk from `apps/api/server.js`: 205 files, **all inside `apps/api/`** — nothing outside `apps/api` is reachable from the live server.

## Rule

DELETE only if (1) `rg`/`git grep` finds zero runtime imports or references, (2) it is in no Railway/Vercel/CI config, and (3) builds + the API baseline pass without it. Otherwise ARCHIVE (`legacy/` + README) or KEEP.

## Manifest

| Path | Type | Why unused | Evidence | Action |
|---|---|---|---|---|
| `server.js`, `server.shim.current.js`, `app_factory.mjs` (root), `core/`, `utils/`, `views/`, `public/` | legacy root API entrypoint tree | Railway runs `apps/api/server.js` (rootDirectory `/apps/api`); root tree only references itself | `apps/api/nixpacks.toml:1-7` ("root nixpacks … never applied"); importers = only root `test/*.test.js`, `scripts/list_routes.mjs`, `scripts/e2e_test_runner.sh`, `dev.sh`, `scripts/dev.sh`, `ops/scripts/boot-satelink.sh`, `ecosystem.config.cjs` (all removed together) | **DELETE** |
| `src/` (root, 23 JS files) | legacy code for the root tree | imported only by root `core/routes.js:3,6`, root tests, broken scripts | `git grep` importers listed above | **DELETE** (except `src/MockUSDT.sol`) |
| `src/MockUSDT.sol` | Solidity duplicate of `contracts/MockUSDT.sol` | `foundry.toml:2` `src = "contracts"` | project rule: never modify any `.sol` without explicit instruction | **KEEP** — founder to decide |
| `test/*.test.js` (root, 16 files), `tests/` | tests for the root tree | not run by any CI job (`npm test` = `turbo test --filter=web`; baseline = `apps/api/test`) | `ci.yml`, root `package.json:46` | **DELETE** |
| `test/foundry/*.t.sol` | forge tests | forge default test dir | `.sol` rule | **KEEP** |
| `dev.sh`, `scripts/dev.sh`, `ops/scripts/boot-satelink.sh`, `ecosystem.config.cjs` | launchers for root `server.js` (pm2 `cwd: ./web` doesn't exist) | target deleted | grep above | **DELETE** |
| `scripts/{execute_payment_intents,run_monthly_settlement,settle_nodeops_billing,setup_dummy_billing}.js` | ops scripts | already broken: import non-existent `../src/db/index.js`, `../src/services/*` | file heads; copies live in `apps/api/src/utils/scripts/` (kept) | **DELETE** |
| `scripts/list_routes.mjs`, `scripts/e2e_test_runner.sh`, `scripts/smoke_nodeops.js` | dev scripts for the root tree | import root `app_factory.mjs` / `src` | `list_routes.mjs:3`, `e2e_test_runner.sh:5,8` | **DELETE** |
| `Dockerfile.backend`, `Dockerfile.frontend`, `ops/docker/` | local compose for root `server.js` (node 18) | only `ops/docker/docker-compose.dev.yml:6-7,24-25` uses them; not Railway/Vercel/CI | `git grep Dockerfile.backend` → only that compose | **DELETE** |
| `packages/database/` (Prisma schema, `db:push`) | workspace `@satelink/database` | "fictional" Prisma schema (never pushed); build is an `echo … skipped` | only importer `services/scheduler/src/index.ts:3` (deleted) | **DELETE** |
| `apps/api/sql/prisma_satelink_schema.prisma` | stray schema | 0 references | `git grep prisma_satelink_schema` → 0 | **DELETE** |
| `services/{reputation-engine,revenue-engine,workload-discovery,scheduler}` | stub workspaces | 0 importers; stub builds (`echo … skipped`); last change 5a980108 (2026-04-20) | `git grep @satelink/<name>` → 0 outside lockfile | **DELETE** |
| `packages/provider` | workspace `@satelinklabs/provider` | no source, no dist, 0 importers | same | **DELETE** |
| `sql/` (9 files) | legacy layer SQL | 0 code refs; referenced by docs (`agent/memory/AUDIT_2026_05_07.md`, `docs/vNext/…`) | `git grep` | **ARCHIVE** → `legacy/sql/` + DO-NOT-RUN README |
| `apps/api/sql/init.sql` | schema bootstrap | loaded by `apps/api/src/core/schema.js:29` (via `gateway.js`, `worker.js`) | | **KEEP** |
| `docker/init/*.sql`, `docker/postgres/init/*.sql` | local compose init | `docker-compose.yml:117`, `docker-compose.dev.yml:46` | | **KEEP** |
| `apps/api/src/core/db/sql/` | legacy SQL | used by `apps/api/src/utils/scripts/migrate.js:10` and `database/__tests__` | | **KEEP** |
| `@rainbow-me/rainbowkit` (`apps/web/package.json`) | dependency | 0 imports (only a comment, `components/deposit/wallet/config.ts:4`) | lockfile prune: 41 entries removed, 0 added, 0 version changes; `ua-parser-js` (AGPL) removed with it — its only dependent was rainbowkit | **DELETE** |
| `apps/api/src/queue/` (BullMQ) | dormant worker code | not reachable from `apps/api/server.js` | reachable via `apps/api/worker.js` ← root `package.json` `"worker"` script + `docker-compose.yml:66` | **KEEP** (in a package.json script) |
| `apps/api/src/middleware/credit_gate.js`, `credit_balances` queries | billing | **LIVE**: `app_factory.mjs:5` → `rpc_gateway.js:9,65`; `app_factory.mjs:171` | | **KEEP** |
| `nginx.staging.conf`, `nginx_staging.conf`, `apps/api/src/utils/scripts/deploy_staging.sh` | staging leftovers (no staging env exists, B-06) | 0 code/config refs (`deploy_staging.sh` → pm2 `ecosystem.config`, deleted) | `git grep` | **DELETE** |
| `.env.staging.example` | staging env template | 0 code refs after the above | `git grep` | **DELETE deferred** — `scripts/pre-commit-gate.sh:24` blocks any staged `.env.*` path, deletions included; not bypassed with `--no-verify`. Delete by hand or fix the gate to use `--diff-filter=ACM` |
| `start-satelink.sh`, `node_heartbeat.js` | stray root scripts | 0 refs (`node_heartbeats` hits are the table name) | `git grep` | **DELETE** |
| `*.bak` (`job_submit.js.bak`, `icon.ejs.bak2`, `admin/command-center/page.jsx.bak`) | editor backups | never loaded | | **DELETE** |
| `apps/web/src/app/(builder)/builder/**`, `(distributor)/distributor/**` | unlinked page folders | no href / nav / footer / sitemap / redirect / role routing | only comments: `components/AuthPanel.tsx:16,73`, `login/page.tsx:4` | **DELETE** |
| `apps/web/src/app/design/page.tsx` | internal render-check page | listed in `scripts/audit-routes.mjs:22`, `robots.ts:25` | | **KEEP** (404 in prod — Phase 7) |
| `apps/web/src/app/styleguide/page.tsx` | e2e fixture | `e2e/styleguide.spec.ts:12,19`, `e2e/routes.smoke.spec.ts:68` | | **KEEP** (404 in prod — Phase 7) |
| `FABLE5_UI_GODMODE.md` | prompt dump | | only `docs/vNext/archive-index/LEGACY_MAP.md` | **ARCHIVE** → `legacy/docs/` |
| `REVENUE_BLOCKER_MATRIX.md`, `STATUS.md` | dated status logs | | LEGACY_MAP; `docs/github-profile-readme-draft.md:8` | **ARCHIVE** → `legacy/docs/` |
| `docs/DEPLOY_CHECKLIST.md` | outdated plan | describes `develop` branch (lines 42, 46, 50, 60); no `origin/develop` exists | | **ARCHIVE** → `legacy/docs/` |
| `AUDIT_REPORT_2026_06.md` | audit snapshot | listed as a canonical doc in `CLAUDE.md` | | **KEEP** |
| `SATELINK_OPS_RUNBOOK.md`, `CONTRIBUTING.md` | runbook / contributor guide | referenced (`scripts/ops/OPS_LOG.md`); CONTRIBUTING mentions `develop` (stale) | | **KEEP** (CONTRIBUTING to be refreshed in Phase 8) |
| `SATELINK_ECOSYSTEM_SETUP_PROMPT.md` | — | not present on `main` or in any branch history | | n/a |
| `.playwright-mcp/` | local MCP artefacts | untracked | | **`.gitignore` added** |
| root `nixpacks.toml` | stale Nixpacks config (`node server.js`, `better-sqlite3`) | documented as never applied | `apps/api/nixpacks.toml:1-7` | **KEEP** — it is a deploy config file; deleting it needs founder confirmation of every Railway service's root dir |
| root `railway.json` | Railway config (`node apps/api/server.js`) | | | **KEEP** |
| `Dockerfile.paperclip`, `railway.paperclip.json`, `start-cloud.sh` | Paperclip deploy files | service FAILED, decommission is a founder action (B-04) | `docs/OPERATIONS.md:38` | **KEEP** until the founder deletes the Railway service |
| `apps/api/src/gateway/routes/staging_auth.js` | route | not reachable from `server.js` (not in the 205) | | **KEEP** (not verified to zero refs; follow-up) |
| `mint.json`, `docs.json` | Mintlify config | a "Mintlify Deployment" check still runs on PRs | | **KEEP** (verify Mintlify project first) |
| `ci.yml:120` `refs/heads/develop` | dead CI condition | no `develop` branch | | **KEEP** (CI edit out of scope; noted) |

## Duplicate migration numbering (document only — never renumber applied migrations)

- `database/migrations/` (the canonical runner path): **no duplicates** (001–019 on `main`).
- `apps/api/migrations/` (manual, no auto-runner): **two `028_` files** — `028_pricing_intelligence.sql`, `028_x402_funnel.sql`; `034_` is missing.
- `apps/api/src/core/db/sql/`: duplicate prefixes `002_`, `009_`, `012_`.
Neither directory is executed automatically; leave as is.

## Licence conflict (B-11) — founder decision, NOT decided here

| Source | Says |
|---|---|
| `README.md:115-117` | `## License` / `MIT` |
| `LICENSE:1` | "MIT License — Copyright (c) 2026 Satelink Network" |
| `LICENSE.BSL` | Business Source License 1.1, Licensed Work "Satelink Platform (this repository)", Change License AGPL-3.0 — with **two inconsistent parameter blocks** ("Change Date: four years from the date of this file" vs "Change Date: 2030-01-01 / AGPL-3.0-or-later") |
| `contracts/LICENSE` | separate contracts licence |
| `packages/sdk`, `apps/mcp-server` `package.json` | `"license": "MIT"`; root `package.json` has no licence field |

## Verification

See the PR description (build of apps/api, web, console, corporate + API baseline) and `docs/trading-agent/EXECUTION_LOG.md` (Phase 4).
