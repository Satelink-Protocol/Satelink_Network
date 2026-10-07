# Stage 40 — Portfolio fit + correlation (Phase 6 item 7)

## Inspection (reuse before build)

| Existing | Where | Used how |
|---|---|---|
| position valuation (net / gross exposure) | `portfolio/pnl.mjs` `valuePosition` (Stage 18) | exposure of every held position |
| fixed-point library, integer sqrt | `strategies/fixed.mjs`, `engines/features.mjs` | exact correlation |
| scorecard `portfolio_fit` dimension | `decision/dimensions.mjs` (item 6) | reads this engine's `score` |
| scorecard gates | `decision/gates.mjs` | new `concentration` gate (fails closed when no assessment) |

## What was built

`portfolio/fit.mjs` — `assessPortfolioFit` (`portfolio-fit/1.0`): gross exposure before/after; the candidate instrument's share of equity after the trade; HHI; exposure-weighted, side-adjusted Pearson correlation of the candidate with every held instrument (≥ 20 aligned returns, otherwise unknown — no credit, no penalty); overlap with the principal's other active strategies. Output: a 0–100 score (penalties: concentration 40, correlation 35, overlap 15, gross 10) and a concentration verdict. **Hard gate:** one instrument > 35% of equity, or gross exposure > 100% of equity, after the trade → `concentration` → REJECT. The portfolio check cannot be skipped: no assessment → the gate fails.

## Test evidence (2026-10-07)

| Suite | Result |
|---|---|
| `apps/api/test/trading_portfolio_fit.test.js` | **13 passing**: correlation 1 / −1 / null / hand value (0.99339926…); exposure and percentages exact (10% / 20% / HHI 0.5); > 35% single instrument fails; adding to a holding counts the combined exposure; > 100% gross fails; a reducing sell lowers concentration; correlated long penalised, correlated short = hedge (no penalty); short history → unknown; overlap excludes the candidate's own strategy; bounded, deterministic score; zero equity refused; **scorecard REJECTs a concentrated candidate** |
| `apps/api/test/trading_scorecard.test.js` | **27 passing** (2 new concentration-gate cases; the property test now covers all 9 gate families) |
| `database/__tests__/trading-decisions.integration.test.ts` | **4 passing** with the real fit engine in the fixture |
| Mutation checks (9) | all caught: instrument concentration ignored, gross exposure ignored, sells add exposure, hedge sign not flipped, correlation without demeaning, own strategy counted as overlap, short overlap trusted, concentration gate dropped, missing assessment passes |

## Blocker impact

| Blocker | Touched? | Why the stage stays inside the accepted isolation |
|---|---|---|
| B-03 / B-06 / B-10 | no | pure functions; no route, no migration |
