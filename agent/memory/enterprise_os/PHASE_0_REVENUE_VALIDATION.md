# PHASE 0 — REVENUE VALIDATION GATE

No event-driven cutover is valid until Satelink can prove revenue truth using
collected cash rather than metered usage.

## Goal

Establish a canonical, founder-readable revenue truth layer before changing
org authority.

## Required Truths

The operating system must be able to validate:
- `collected_usdt`
- `active_paying_wallets`
- `recurring_deposits`
- `revenue_per_hour_collected`
- `cash_conversion_pct`

## Canonical Distinction

Use the financial model already documented in `docs/FINANCIAL_TRUTH_REPORT.md`:
- metered value is not cash
- allocated value is not cash
- unpaid value is not cash
- treasury real and claimed value are the cash-adjacent truths

## Required Validation Path

At least one revenue path must be documented end to end:

`machine usage`
-> `revenue event recorded`
-> `wallet funded`
-> `treasury receipt confirmed`
-> `claimable or settled state confirmed`

Primary reference documents:
- `docs/FINANCIAL_TRUTH_REPORT.md`
- `docs/SETTLEMENT_FLOW.md`
- `docs/architecture/SATELINK_REVENUE_FLOW.md`

## Daily Founder Revenue Summary Format

Every daily summary must include only cash-relevant truth:

```md
# DAILY REVENUE TRUTH — YYYY-MM-DD

- Collected USDT (24h):
- Collected USDT (7d rolling):
- Active paying wallets (24h):
- Recurring deposits (7d):
- Revenue per hour collected:
- Cash conversion %:
- Treasury health ratio:
- Customer Zero stage:
- Open REV-1 events:
- Blocking approval required:
```

## Phase 0 Exit Criteria

- Revenue truth can be produced without queue polling
- One real or testable payment path is documented end to end
- Founder KPI set can be computed from current system sources
- Customer Zero target criteria are defined
- Funnel event taxonomy is defined

## Failure Rule

If metered value is increasing while collected cash remains unverified,
Phase 0 remains open and no org authority migration may proceed.
