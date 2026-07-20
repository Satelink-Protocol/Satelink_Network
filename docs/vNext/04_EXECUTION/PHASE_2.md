# Phase 2 — Recurrence and Generalization

> Entry condition: M1 done AND T4 (recurrence) attempted with dated result. Objective: turn one spread event into a system that earns while nobody works on it (T6: zero-touch week), and widen from 1 resource to a governed catalog.

## Objectives

1. **Catalog resale (B-10).** Crawler-driven: top-K probed, resale-permissive Bazaar resources are automatically listed as `/x/<slug>` with formula pricing. Policy file (category allowlist, margin bounds, per-adapter caps) is the only human input. Metric: routable external suppliers (today 0 → target: every probed-healthy listing in allowed categories).
2. **Reputation-scored routing (B-9).** Scores from probe+live windows; breaker ported; exploration bounded at 5%. Metric: routed-unit success rate ≥ 99% on scored suppliers.
3. **Failure economics (B-11).** Paid-retry budgets, loss-avoided accounting, full T5 chaos drill on live rails with minimum caps.
4. **Zero-touch week (B-12 → T6).** Deploy freeze + no manual actions for 7 days with the loop running. This gate, not a revenue number, is what "Autonomous Revenue OS" means. Failing it honestly (with the intervention log showing *why* a human was needed) defines Phase 2's real backlog.
5. **Hygiene completion (B-13, H-1..H-3).** Import lint enforced; orphan roots physically archived per MIGRATION_PLAN gates; zero-traffic experimental mounts flagged off with dated evidence.

## Scale posture

- Caps raise only by ADR, only after T5 passes, and only in steps (e.g., $5/day → $25/day → $100/day) with a week of clean ledger between steps.
- Concurrency: the Express monolith held 496k req/day of free RPC [measured]; paid resale volume in Phase 2 will be orders of magnitude below that. No infra work is justified by projected load — only by measured load (First Principle #7).

## Demand growth in Phase 2 (still zero-outreach)

Permitted levers, all machine-facing:
- More concrete listings with better method-level descriptions (measured effect via S-1/P-1 data).
- Tool-manifest surfaces (OpenAPI, LangChain/MCP indexes) enumerating `/x/*` resources [code: surfaces exist].
- Publishing x402-kit examples that use Satelink endpoints (founder-owned repo; developer-mindshare channel, not sales).
Forbidden levers remain forbidden: outreach, ads, discounts-below-cost, fabricated activity.

## Phase-2 exit criteria

| Gate | Threshold |
|---|---|
| T4 | recurrence: non-founder spread events in ≥ 2 distinct weeks |
| T5 | full chaos drill passed on live rail |
| T6 | zero-touch week passed, or failed with intervention log converted to backlog and re-run scheduled |
| Catalog | ≥ 5 external suppliers routable; ≥ 1 non-self-supply resource with a real spread event |
| Hygiene | import lint green; orphan roots archived |

## Phase-2 anti-goals

No second rail yet (that is Phase 3, and only for independence, not capacity). No new ecosystem adapter unless its rejection-log trigger fires — and if one fires, its scorecard admission is Phase-3 work, not a Phase-2 detour.
