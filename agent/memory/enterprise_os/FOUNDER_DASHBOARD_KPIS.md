# FOUNDER DASHBOARD KPI SPEC

This dashboard exists to answer one question:
is Satelink becoming a self-operating, cash-generating system?

## Required Metrics

- `collected_usdt_24h`
- `collected_usdt_7d`
- `collected_usdt_30d`
- `active_paying_wallets_24h`
- `active_paying_wallets_7d`
- `machine_customers_active`
- `protocol_customers_active`
- `recurring_deposits_7d`
- `revenue_per_hour_collected`
- `cash_conversion_pct`
- `customer_zero_stage`
- `rev1_open_events`
- `founder_interventions_per_week`
- `automation_capture_rate`

## Definitions

### `collected_usdt_*`
Cash actually received or confirmed in treasury / claimable path, not metered
usage value.

### `active_paying_wallets_*`
Wallets with confirmed paid usage in the measurement window.

### `machine_customers_active`
Distinct active machine customers producing paid usage.

### `protocol_customers_active`
Distinct active protocol or integration customers producing paid usage.

### `recurring_deposits_7d`
Wallets that funded more than once in the last 7 days.

### `revenue_per_hour_collected`
Collected USDT divided by operating hours in the time window.

### `cash_conversion_pct`
Collected cash divided by metered value for the same observation window.

### `customer_zero_stage`
Current lifecycle stage from `CUSTOMER_ZERO_PROGRAM.md`.

### `rev1_open_events`
Count of unresolved `REV-1` events in `ACTIVE_EVENTS.md`.

### `founder_interventions_per_week`
Manual founder actions that were necessary to keep revenue, security, or
delivery moving.

### `automation_capture_rate`
Share of founder interventions that became backlog automation items or
guardrails.

## Explicitly Excluded

Do not display as primary health metrics:
- task count
- commit count
- issue count
