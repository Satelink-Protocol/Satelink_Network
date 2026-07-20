# Keep / Remove / Archive

> The classification, actionable. Four classes — note "REMOVE" is deliberately absent as a Phase-1 action: nothing is deleted during the reset (mandate + Rule #8). "Archive class" = declared dead for vNext purposes, moved physically only via the safe procedure in `MIGRATION_PLAN.md`, later.

## Classes

- **CORE** — becomes part of the vNext engine (imported or ported into `apps/api/src/vnext/`).
- **ADAPTER** — survives as (or inside) a workload/rail adapter.
- **OPERATIVE-LEGACY** — keeps running untouched (live product surface, safety systems); vNext neither uses nor disturbs it.
- **ARCHIVE** — dead for vNext; no new imports allowed from it, physical relocation deferred.

## CORE

| Code | Role in vNext |
|---|---|
| `apps/api/src/payments/x402/{config,middleware,settlement}.js` | RailAdapter `x402-base`, inbound half |
| x402-kit client flow (external repo, to be ported) | RailAdapter `x402-base`, outbound half |
| `apps/api/src/settlement/adapters/{ISettlementAdapter,BaseSettlementAdapter,Shadow*,Simulated*}.js` | RailAdapter interface precedent + test doubles |
| `apps/api/src/routes/credits.js` + `api_credits` | bundle credit path |
| `apps/api/src/economics/pricing_intelligence/{price_floor,market_intel,pricing_brain}.js` | Pricing Engine inputs |
| `apps/api/src/nodes/node_circuit_breaker.js` | per-supplier breaker |
| `apps/api/src/scheduler/` cron host (job registration only) | crawl/probe scheduling |
| `apps/api/src/payments/founder_wallets.js` | test-data flagging |
| `apps/api/src/admin/` router + auth | `/vnext/admin/*` observability mount point |

## ADAPTER

| Code | Adapter |
|---|---|
| `apps/api/src/workloads/rpc_gateway/` | `rpc` WorkloadAdapter — self-supply supplier #1 |
| `.well-known` / OpenAPI / LangChain-tools routers | Demand Import discovery surfaces |
| `apps/api/src/workloads/ai_gateway/` | dormant seed for `ai-inference` adapter IF its reopen trigger fires (do not extend until then) |

## OPERATIVE-LEGACY (running, untouched, not part of vNext)

- `app_factory.mjs` and all mounts not listed above (auth, keys, nodes API, webhooks, oracle, machine-access, MEV relay mount, financial-truth, deposit routers).
- `freeTierGate` + `security/` classifier stack (free-tier defense; also founder-frozen file).
- `economics/epoch_scheduler.js` + Polygon anchor path, `SETTLEMENT_DRY_RUN=1` (Rule #3).
- `apps/web`, `packages/ui`, admin observer endpoints, monitoring stack.
- `contracts/` (frozen), `agent/memory/` (never delete).

## ARCHIVE (dead for vNext — no new imports; physical move deferred)

| Group | Contents | Evidence of deadness |
|---|---|---|
| Orphan roots | top-level `src/`, `core/`, `services/`, `agents/`, `utils/`, root `app_factory.mjs`, `server.shim.current.js`, `node_heartbeat.js`, surplus Dockerfiles/nginx confs | not imported by live app [verified] |
| Supply-recruitment stack | `nodes/{node_onboarding*,node_reputation,reputation_engine,region_engine,node_capacity}.js`, `genesis-nodes/`, `economics/{node_incentives,node_earnings}.js`, `settlement/{rewards,futures_escrow,job_escrow,batch_creator,claim_generator,withdraw*,withdrawal*}.js` | zero external nodes ever [measured]; withdrawal tests in known-fail baseline |
| Aspirational market engines | `scheduler/{market_scanner,demand_flywheel_engine,workload_acquisition_engine,job_matching_engine,task_generator,workload_discovery}.js`, `workloads/{auto_ops_engine,auto_reward,auto_surge,workload_acquisition_engine,recommendation_engine}.js`, `marketplace/settlement_router.js`, `autonomous/`, `autonomous_revenue/` | no connected counterparties; no money-path consumers |
| Revenue-narrative engines | `economics/{revenue_oracle,revenue_forecast_engine,revenue_stability_service,economic_ledger,profitability_engine,breakeven_service,growth_engine,authenticity_service,retention_service,economics_stats}.js` | computed narratives over ~$0 measured revenue; fed the fabricated-dashboard era |
| CRM/outreach thesis | `reports/machine_crm_core.js`, outreach engine + campaigns surface | thesis rejected [measured conversion ~zero; founder rejection of cold outreach] |
| Workload experiments (pending H-2 traffic measurement) | `workloads/{defi_gateway,bridge_gateway,bandwidth_proxy,mev_relay,oracle}` and related mounts | no measured revenue; mounted — so measure request counts before declaring, see MIGRATION_PLAN |
| Dead-but-referenced | `gateway/admin_api_v2.js` + `unified_dashboard_api.js` orphan pair | kept only by each other [git: Phase 10 note] |

## Enforcement

1. **Import lint** (Phase 1, item H-3): CI check — files under `apps/api/src/vnext/` may not import from ARCHIVE-class paths; the class list lives in a machine-readable manifest `docs/vNext/03_ENGINEERING/archive-manifest.json` (created when H-3 lands, additive).
2. Archive-class files get no bug fixes, no refactors, no new tests. If production breaks inside one, the fix is to route around it, with an ADR.
3. Reclassification requires editing this doc via PR with evidence.
