# Code Audit — 2026-07-20

> Zero-based audit of the repository as legacy software. Method: directory census, live-mount tracing from `apps/api/app_factory.mjs`, dependency grep, cross-check against verified production state (CLAUDE.md 2026-07-16 numbers) and prior audits (2026-06-13, 2026-06-21). Classifications feed `KEEP_REMOVE_ARCHIVE.md`.

## Ground truth about what is actually live

- The deployed product is **one Express app**: `server.js` → `apps/api/app_factory.mjs` (461 lines, 33 `app.use` mounts) on Railway; deploy = merge to `main` only [measured: railway redeploy does not ship local code].
- The live money path: `/rpc` mount at `app_factory.mjs:369` = `x402Middleware → freeTierGateUnlessX402Paid → createRpcGateway(pool)`, plus `/credits` (deposit initiate/notify) and the epoch scheduler (dry-run) [code].
- Production reality: 496,273 req/24h, p50 46ms, ~zero real revenue, x402 rail live with real but tiny settlement history [measured 2026-07-16].
- Postgres: 32 tables, 304 MB. Test baseline: 128 pass / 9 known-fail [measured 2026-07-16].

## Census (JS/MJS files per area)

### `apps/api/src/` — the real codebase (~660 files)

| Dir | Files | Live? | Audit verdict (summary) |
|---|---|---|---|
| `utils/` | 227 | partially | **Largest single liability.** 227 utility files for a 33-route app is accretion, not architecture. Not individually audited (out of scope for docs-only pass); rule: vNext code may import a util only after reading it. |
| `gateway/` | 70 | partially | 20 dead route files already deleted in Phase 10 [git]; `admin_api_v2.js` kept only for orphan `unified_dashboard_api.js`. Remaining files: mixed live/dead; needs file-level pass in Phase 1 hygiene (H-1). |
| `workloads/` | 48 | partially | `rpc_gateway/` LIVE (the product). `ai_gateway/`, `bandwidth_proxy/`, `mev_relay/`, `defi_gateway/`, `bridge_gateway/`, `oracle/`, `webhooks/` — mounted experiments with no measured revenue; candidates for archive class after mount-traffic measurement (H-2). |
| `monitoring/` | 29 | partial | prom-client/pino exist [memory: monitoring]; keep. |
| `economics/` | 27 | partial | LIVE: `epoch_scheduler` (dry-run), `pricing_intelligence/` (6 files, PR #242). ARCHIVE class: forecast/oracle/authenticity/growth/profitability narrative engines (no money-path consumers). |
| `core/` | 26 | UNKNOWN | name-collision with top-level `core/`; needs H-1 pass. |
| `security/` | 21 | LIVE | classifier stack; 70,608 IPs classified [measured]. Keep. |
| `settlement/` | 20 | partial | `adapters/` (9 files incl. `ISettlementAdapter`) = the best abstraction in the repo → PORT. Escrow/rewards/withdrawal files = archive class (withdrawal tests already in known-fail baseline). |
| `machine-access/`, `queue/` | 16+16 | mounted | `/machine-access/v1` and queue infra live; keep as-is, not in vNext path. |
| `scheduler/` | 14 | partial | cron host = KEEP; `market_scanner`, `demand_flywheel_engine`, `workload_acquisition_engine`, `job_matching_engine`, `task_generator`, `workload_discovery` = aspirational autonomous-market engines with no connected counterparty → ARCHIVE class. |
| `nodes/` | 12 | technically live, functionally empty | registry serves only the self-heartbeat [measured: zero external nodes]. PORT: `node_circuit_breaker.js`; concepts from reputation/capacity. ARCHIVE class: onboarding engines (incl. a `.backup` file in-tree). |
| `payments/` | 5+x402 | **LIVE, crown jewel** | `x402/{config,middleware,settlement,funnel}.js` mainnet-proven; `founder_wallets.js` (test-data flagging) essential. |
| `routes/` | 9 | LIVE | `credits.js` (idempotent deposits) is load-bearing. |
| `admin/` | 8 | LIVE | admin router + 18 observer endpoints, SQL-validated [measured]. |
| others (`auth/`, `db/`, `billing/`, `providers/`, `integrations/`, `jobs/`, `genesis-nodes/`, `autonomous/`, `autonomous_revenue/`, `ops-agent/`, `dashboard_api/`, `execution/`, `realtime/`, `reports/`, `services/`, `marketplace/`) | ~70 | mixed | `auth`/`db` live. `genesis-nodes`, `autonomous_revenue`, `ops-agent`, `marketplace` (1 file), `reports/machine_crm_core.js` = archive class — aspirational layers over the empty network / rejected CRM-outreach thesis. |

### Orphan roots (top level, outside `apps/`)

`src/` (24), `core/` (12), `services/` (10), `agents/` (3), `utils/` (2), root `app_factory.mjs` (a 26-line stub), `server.shim.current.js`, `node_heartbeat.js`, 5 Dockerfiles, 2 nginx staging confs. **Not imported by the live app** [verified: live server imports `apps/api/app_factory.mjs`]. Verdict: archive class wholesale. They are the single biggest source of agent/human confusion (two `app_factory.mjs`, three `core/`-named trees).

### Everything else

- `contracts/` — FROZEN (Rule #5). RevenueVaultV2 deployed and live [measured]; a source variant sits in git stash "PRESERVED-2026-07-16" pending founder reconciliation.
- `apps/web` — live Vercel frontend; not in the vNext money path; unaffected.
- `packages/ui` — live token system (PR #214); unaffected.
- `agent/memory/` — never delete (Rule).
- Docs: 88 files under `docs/` + 8 root — mapped in `../archive-index/LEGACY_MAP.md`.

## The three verified structural facts vNext is built on

1. **Inbound machine settlement works** — `payments/x402/` + CDP facilitator, mainnet-proven [code+measured].
2. **Outbound machine payment is absent** — zero client-side x402 code in-repo [grep-verified]; working prototype exists in the external x402-kit repo (4 mainnet txs [measured]).
3. **A settlement-adapter abstraction already exists** — `settlement/adapters/ISettlementAdapter.js` family, including Shadow adapters (full path, no broadcast) [code] — the exact pattern vNext's RailAdapter needs.

## Stop-condition assessment (required by the reset mandate)

**The repository does NOT prevent the vNext architecture.** No blocking migration is required: the core mounts additively in the live app, reuses the live deploy pipeline, and adds only new tables. The genuine blockers are (a) one missing component (outbound payer — bounded, portable from x402-kit) and (b) hygiene debt (orphan roots, 227-file utils) that raises cost-of-change but blocks nothing. Smallest migration: none — Phase 1 is purely additive. Details in `MIGRATION_PLAN.md`.
