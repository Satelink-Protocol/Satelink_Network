# Stage 20 — Shadow revenue engine (option 2)

**Decision (founder order, 2026-10-07):** Stage 20 option 2 — build the revenue engine as a **shadow projection** in `apps/api/src/trading_agent/revenue/**` only. No writes to the Financial-OS ledger, no schema change to existing ledger tables, no new migration. Flag `REVENUE_ENGINE`, default OFF.

## Inspection (reuse before build)

| Existing piece | Where | Reused how |
|---|---|---|
| `SimSubscriptionBook` (Stage 27) | `billing/books.mjs` | same conventions: balanced double entry, idempotent posting key, bigint minor units, frozen entries, `sim:` accounts; `RealBookPosting` still refuses — the ledger decision is unchanged |
| `SimCommissionBook` (Stage 23) | `brokers/alpaca/sim_book.mjs` | same; commission becomes one engine stream |
| Binance rebates (Stage 21) | `brokers/binance/rebates.mjs` | read-only source; rebate becomes one engine stream |
| Three-way matcher (Stage 34) | `scripts/trading/real-revenue-verify.mjs` | **the definition of "matched evidence"**: `evidence.mjs` turns only `matched` + `REAL-REVENUE-VERIFIED` items into settlement evidence |
| Flags | `flags.mjs` | `REVENUE_ENGINE` already existed (unused) |

Nothing new was needed in the database: the engine is an in-memory projection fed by events and evidence. A persistent store, if wanted, is a later founder decision tied to the real ledger kinds (U2).

## Design

- **Chart of accounts** (`accounts.mjs`): per book (`sim:` / `real:`), per stream (subscription, rebate, commission, usage): `receivable`, `revenue_expected`, `revenue`, `contra:refunds`; plus `clearing:gateway`, `expense:gateway_fees`, `expense:model_cost`, `liability:model_provider`.
- **Posting rules** (`posting_rules.mjs`, pure):
  - expected: DR receivable / CR revenue_expected
  - matched settlement: DR clearing (net) + DR fees / CR receivable (gross); DR revenue_expected / CR revenue (**expected → actual**)
  - refund: open part reverses the accrual; settled part → DR contra:refunds / CR clearing
  - model cost: DR expense:model_cost / CR liability:model_provider (margin only)
- **Real vs sim books** never mix (`SIMULATED_IN_REAL`, `REAL_IN_SIM`).
- **Expected → actual only on matched evidence**: refused unless matched, settled, customer-funded, with a statement reference, same currency, and ≤ the open expected amount (`OVER_RECEIPT` → human review). Idempotent by evidence id.
- **Variance report** (`shadow-revenue-variance/1.0`): expected / actual / refunded / variance per stream and currency, and every unmatched or partial item. Amounts are strings.

## Test evidence (2026-10-07)

| Suite | Result |
|---|---|
| `apps/api/test/trading_shadow_revenue.test.js` | **26 passing**: flag off → DISABLED; charts disjoint + namespaced; rules balanced, deterministic, frozen; floats / negatives / zero / bad currency refused; books refuse cross-mode items; idempotent + append-only; expected credits only `revenue_expected`; matched settlement → actual, cash = net; **10 refusal paths post nothing** (not matched, no statement ref, not settled, founder-funded, funding unverified, simulated, test mode, currency, over-receipt, unknown event); partial → residual in variance; refunds open/settled + over-refund; 300-step random sequence stays balanced in both books; **integration with the real Stage 34 matcher** (verified bundle → 3 evidence items → zero variance; clearing = bank statement line; a STOPped path yields no evidence); isolation (no ledger import, no SQL, no migration, not mounted) |
| Mutation checks (8) | all caught: matched check dropped, over-receipt allowed, real book accepts simulated, cash booked gross, expected credits actual revenue, refund ignores open part, flag gate removed, founder-funded accepted |
| Postgres integration | **not applicable by design**: the option-2 engine has no table (the order forbids a schema change); the integration test runs against the real matcher instead |

## Blocker impact

| Blocker | Touched? | Why the stage stays inside the accepted isolation |
|---|---|---|
| B-03 / B-06 / B-10 | no | no route, no mount, no migration |
| B-07 (schema drift / `revenue_events_v2`) | no | nothing maps into `revenue_events_v2` or any ledger table |
| B-09 (scope / legal) | no | the engine recognises nothing; recognition in the real ledger stays a founder decision (new `ledger_txns` kinds, U2) |
| U2 / ledger kinds | **not resolved** | `RealBookPosting` still refuses; this engine's variance report is the *input* to that approved process |
