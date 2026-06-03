# REVENUE FUNNEL ANALYTICS

## Purpose

Define the event and metric contract for machine-to-machine revenue conversion.

## Funnel Stages

1. Anonymous machine traffic
2. Identified wallet
3. Funded wallet
4. Active paying wallet
5. Recurring depositor
6. Machine customer
7. Protocol customer

## Required Event Types

- `funnel.wallet_identified`
- `funnel.deposit_started`
- `funnel.deposit_confirmed`
- `funnel.first_paid_call`
- `funnel.recurring_deposit`
- `funnel.customer_retained`
- `funnel.customer_at_risk`

## Event Ownership

Primary owner:
- `ECONOMY_COMMANDER`

Support role packs:
- `DEMAND_COMMANDER` for wallet identification and top-of-funnel progression
- `CONVERSION_COMMANDER` for deposit and first paid call conversion
- `RETENTION_COMMANDER` for recurring deposits and churn risk

## Output Metrics

- wallet activation rate
- funded-to-paying conversion
- paying-to-recurring conversion
- machine customer count
- protocol customer count
- revenue per hour by customer cohort

## Required Questions The Funnel Must Answer

- How many machines are anonymous but active?
- How many wallets are identified but unfunded?
- How many funded wallets never become paying wallets?
- How many paying wallets never become recurring depositors?
- Which cohort produces the highest revenue per hour?

## Event Quality Rules

- Do not count metered traffic as a customer conversion without funded usage.
- Do not count a funded wallet as active-paying without observed paid calls.
- Do not count recurring status from a single deposit.
