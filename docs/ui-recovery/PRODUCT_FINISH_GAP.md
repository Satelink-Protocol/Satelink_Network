# PRODUCT_FINISH_GAP.md

Satelink OS benchmarked against Railway / Cloudflare / Grafana / Datadog. Only actionable
items. Every item cites a concrete file or absence verified in the repo.

Priority: **P0** = blocks "production-finished" feel / correctness · **P1** = expected of a
peer infra product · **P2** = polish.

---

## P0 — must fix to feel production-finished

| ID | Gap | Evidence | Action |
|---|---|---|---|
| P0-1 | OS shell is untracked | `apps/web/src/app/satelink/os/layout.tsx` not in git | `git add` + commit; wrap children in `ErrorBoundary` (`PRODUCT_STANDARDIZATION.md` S0). |
| P0-2 | Dead, drifted UI fork ships in the bundle | `apps/web/src/components/ui/*` (11 files, all DIFFER from `@satelink/ui`), imported by no page | Delete fork + `shadcn-trial` (`DESIGN_SYSTEM_CONSOLIDATION.md` A). |
| P0-3 | Two frontends = fragmented product | `apps/dashboard` (112 pages, 0 `@satelink/ui`, unbuildable `next`) | Retire (`LEGACY_FRONTEND_PLAN.md`). |
| P0-4 | No monitoring surface in-product | No `os/monitoring` route; Grafana not deployed | Embed Grafana in OS (`GRAFANA_INTEGRATION_PLAN.md`). Railway/Datadog have metrics front-and-center; Satelink has none. |
| P0-5 | Command center missing core ops sections | `command-center` has no Billing/Security/Alert views (verified NAV ids) | Add 3 views (`COMMAND_CENTER_V3_PLAN.md` C2–C4). |
| P0-6 | Stale backup file checked in | `apps/web/src/app/admin/command-center/page.jsx.bak` | `git rm`. |

---

## P1 — expected of a peer infrastructure product

| ID | Gap | Evidence | Action |
|---|---|---|---|
| P1-1 | Onboarding flow not stitched | Deposit → API key → first call not linked (`os/deposit` has no path to `os/keys`); CLAUDE.md §5 lists this as a revenue blocker | Add post-deposit CTA/redirect to `os/keys`; "first request" quickstart on `os/keys`. |
| P1-2 | `os/keys` lacks at-a-glance health | No `KPIGrid`/`EmptyState` (verified) | `PRODUCT_STANDARDIZATION.md` S1. Cloudflare/Railway key pages lead with usage + status. |
| P1-3 | Settlement state opaque to operator | `command-center` `treasury` view doesn't surface `POLYGON_SIGNER_KEY` presence / last tx / vault balance | `COMMAND_CENTER_V3_PLAN.md` C5. The #1 documented revenue blocker should be visible, not buried in env. |
| P1-4 | Revenue truth ambiguity | "metered (unbilled)" vs "collected on-chain" not consistently distinguished | C6 — enforce CLAUDE.md "real data only" labeling in the revenue view. |
| P1-5 | Domain viz still outside the design system | `command-center` imports `@/components/satelink-os` for 7 viz components | Extract to `@satelink/ui` (`COMMAND_CENTER_V3_PLAN.md` C7) so `@satelink/ui` is truly the sole source. |
| P1-6 | No global command palette parity | `DashboardShell` has search per-shell, but `command.tsx` exists in `@satelink/ui` unused beyond it | Wire a cross-view ⌘K (Railway/Linear-class) spanning OS + admin. |
| P1-7 | No distributed tracing / log correlation | Gaps 1–2 in `GRAFANA_INTEGRATION_PLAN.md §1` (no OTel SDK, no Loki shipper) | Datadog/Grafana parity needs traces↔logs; add OTel + Alloy drain. |

---

## P2 — polish

| ID | Gap | Action |
|---|---|---|
| P2-1 | `docs/page.tsx` renders shell-less | Optionally render inside OS shell when in-product so docs feel native (Stripe/Cloudflare pattern). |
| P2-2 | Empty/loading states uneven across pages | Standardize on `AsyncBoundary` everywhere (`PRODUCT_STANDARDIZATION.md` S2–S3). |
| P2-3 | No theme toggle surfaced | `next-themes` is a dependency; expose a toggle in `DashboardShell` header. |
| P2-4 | Tenant-scoped views not yet templated | Once Grafana embeds land, drive per-`node_id`/`api_key` dashboard variables for self-serve operators. |

---

## Dimension scorecard (current vs peer bar)

| Dimension | Satelink today | Peer bar | Gap |
|---|---|---|---|
| Navigation / IA | Good (DashboardShell, grouped nav) | Railway | Small — add Monitoring + 3 admin views |
| Design-system consistency | OS pages strong; fork+legacy drag it down | Vercel | P0-2, P0-3 |
| Onboarding | Pages exist, not stitched | Cloudflare | P1-1 |
| Monitoring | Absent in-product | Grafana/Datadog | P0-4, P1-7 |
| Billing | Deposit/usage/keys pages exist | Stripe-class | P1-1, P1-2 |
| Command center | Multi-view cockpit, 3 sections missing | Datadog | P0-5, P1-3/4 |
| Developer experience | Keys + docs present, quickstart thin | Railway | P1-1, P2-1 |

---

## Recommended execution order
1. P0-1, P0-2, P0-6 — zero-risk cleanup (commit shell, delete fork + bak). One PR.
2. P0-3 — retire `apps/dashboard`. One PR.
3. P1-1, P1-2, P1-3, P1-4 — onboarding + revenue-truth wiring on existing data.
4. P0-5 (C2–C4) — new command-center views.
5. P0-4 + P1-5 + P1-7 — Grafana embed + viz extraction + tracing (largest effort).
