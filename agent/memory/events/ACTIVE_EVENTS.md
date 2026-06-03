# ACTIVE EVENTS
# Status: Shadow mode mirror
# Updated: 2026-06-03

Each open event has one accountable owner.

| Event ID | Type | Severity | Owner | Status | Subject | Source | Dedupe Key | Notes |
|----------|------|----------|-------|--------|---------|--------|------------|-------|
| EVT-REV-001 | `revenue.validation.required` | `REV-1` | `ECONOMY_COMMANDER` | `ACTIVE` | `revenue_truth` | `enterprise_os.phase0` | `phase0-revenue-truth` | Phase 0 gate remains open until collected-cash metrics are validated from current sources. |
| EVT-OPS-001 | `incident.local_diagnostic_failure` | `OPS-2` | `ENGINEERING_COMMANDER` | `ACTIVE` | `local_api_and_diagnostic` | `ALERTS.md` | `better-sqlite3-local-api` | Mirrors repeated local `better-sqlite3` diagnostic failure and local API unreachable alert chain. |
| EVT-REV-002 | `revenue.payment_flow_verification` | `REV-2` | `ECONOMY_COMMANDER` | `ACKED` | `usdt_payment_flow` | `PROGRESS.md` | `c4-1-usdt-payment-flow` | Mirrors legacy `C4-1` payment-flow verification work while queue compatibility remains active. |
| EVT-CUST-001 | `customer.zero.definition_required` | `REV-2` | `ECONOMY_COMMANDER` | `NEW` | `customer_zero` | `enterprise_os.customer_zero_program` | `customer-zero-definition` | Customer Zero program defined but not yet proven with a retained paying machine or protocol customer. |
| EVT-AUTO-001 | `founder.action_taken` | `OPS-3` | `AUTONOMY_COMMANDER` | `NEW` | `daily_revenue_truth_summary` | `enterprise_os.automation_backlog` | `founder-daily-revenue-summary` | Founder still performs revenue-truth synthesis manually; automation candidate must be captured. |
