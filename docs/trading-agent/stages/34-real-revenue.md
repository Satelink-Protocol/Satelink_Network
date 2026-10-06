# Stage 34 — REAL REVENUE GATE 1: verification tooling

**No real revenue was verified, because none exists yet.** Stage 34 triggered its STOP: no real trade (Stage 33), no live billing approval (Stage 27), and real-book posting blocked by Stage 20, so there's no amount to match. The founder chose **Option 2** (2026-10-06): docs plus a read-only matching tool with an accounting reconciliation test. No path is REAL-REVENUE-VERIFIED.

PR: #TBD (draft, stacked on #487)

## Inspection (read-only, 2026-10-06)

| Path / check | Result |
|---|---|
| Rebate | no real trade; Binance UNVERIFIED (no Link ID); Stage 21 rebate sources only report and never book; Link-and-Trade is a placeholder |
| Subscription | live Razorpay keys refused at construction; routes unregistered; `SUBSCRIPTIONS` flag off |
| Real book | `RealBookPosting` throws `LEDGER_NOT_APPROVED` (Stage 20); `ledger_txns.kind` has no revenue kind; no trading code deployed; no production access used |
| Statements | none supplied |

## What was built

| Piece | Path |
|---|---|
| Read-only three-way matcher | `scripts/trading/real-revenue-verify.mjs` |
| Accounting reconciliation test | `apps/api/test/trading_real_revenue.test.js` (25) |
| Verification procedure | `docs/trading-agent/evidence/real-revenue-verification.md` |
| Evidence pack (all PENDING) | `docs/trading-agent/evidence/first-real-revenue.md` |

## How it decides

- **Three-way match:**
  - each gateway or broker record has exactly one journal transaction (`refType`/`refId`): posted, balanced, same currency, credits to receivable or revenue equal to gross, fee plus tax on the fee booked to `fee_expense`;
  - its settlement has exactly one statement credit, equal to the settlement's net (Razorpay batches several payments into one bank credit).
- **Refused, never counted:** test-mode or simulated (`sim:` accounts included), founder-funded, funding not verified, not settled, unmatched either way, orphan statement lines, orphan revenue journals, duplicates, currency mismatches, any variance.
- **Per-path verdict:** a path is verified on its own; an empty path is `NO_EVIDENCE`. A variance on a settlement batch un-matches every payment in it.
- **Recognition:** matched items are listed as eligible for receivable → revenue through the approved ledger process. The tool posts nothing; corrections are reversal entries, never deletes.
- **Outside git:** inputs and reports inside the repository are refused, so statements can't be committed. Evidence rows carry ids only.

## Test evidence (2026-10-06)

- `trading_real_revenue.test.js`: 25 passing, all on synthetic data. Coverage:
  - both paths verified on a clean bundle (2 Razorpay payments in one settlement with fees and GST on the fee, plus 1 Binance rebate);
  - each path judged on its own;
  - 18 seeded STOP cases, each refused only on its own path;
  - batch un-matching;
  - CLI exit codes 0/1/2, with in-repo paths refused;
  - read-only source checks.
- Mutation checks: 18 of 18 killed.

## Deviation from "evidence docs only"

The brief allowed evidence docs and a reconciliation job run in verify mode. No existing job covers trading revenue: `workers/reconciler` handles on-chain RPC deposits. So this stage adds a read-only script and its test. The founder approved this explicitly (Option 2).

## Blocker impact

| Blocker | Touched? | Note |
|---|---|---|
| B-09 (scope / legal) | referenced | revenue from rebates or subscriptions needs the partner and legal sign-offs first |
| Stage 20 | blocking | the revenue ledger kinds / real-book posting decide what the journal export contains |
| Stage 27 / 33 | blocking | live billing approval / the first real trade |

No blocker changes status. The Stage 34 row is added to the acceptance log in `docs/trading-agent/BLOCKERS.md`.

## Rollback

Revert the commit: additive script, test and docs. Ledger corrections themselves are reversal entries only (see the procedure).
