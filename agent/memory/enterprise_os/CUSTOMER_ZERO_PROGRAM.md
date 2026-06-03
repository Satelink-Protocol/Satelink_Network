# CUSTOMER ZERO PROGRAM

## Definition

Customer Zero is the first intentionally managed real paying machine customer or
protocol customer that validates Satelink's paid path end to end.

## Owner

Primary owner:
- `ECONOMY_COMMANDER`

Support:
- `ENGINEERING_COMMANDER` for delivery reliability and failure isolation
- `SECURITY_COMMANDER` for trust review, treasury checks, and secret-safe flows

## Why This Exists

Satelink needs a revenue operating system, not generic activity.
Customer Zero is the shortest path from architecture to collected USDT truth.

## Customer Zero Lifecycle

1. Targeted
2. Onboarded
3. Activated
4. First deposit received
5. First successful paid usage
6. Recurring usage observed
7. Retained

## Event Triggers

- `customer.zero.targeted`
- `customer.zero.onboarded`
- `customer.zero.activated`
- `customer.zero.deposit_received`
- `customer.zero.first_paid_usage`
- `customer.zero.at_risk`
- `customer.zero.retained`

## Qualification Rules

Customer Zero is valid only if:
- a wallet is known,
- deposit is confirmed,
- paid usage is observed,
- and the usage contributes to cash-relevant revenue reporting.

## At-Risk Conditions

Escalate as `REV-2` if:
- deposit stalls,
- paid usage fails after funding,
- delivery uptime blocks usage,
- or recurring behavior does not materialize after activation.

## Outputs Required

- current stage
- owner
- latest blocking event
- next conversion action
- trust or security blockers
