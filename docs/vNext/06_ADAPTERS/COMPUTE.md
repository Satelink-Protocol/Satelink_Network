# Adapter: General Compute / FaaS

- **Status:** REJECTED (2026-07-20)
- **Kind:** Workload adapter (candidate)

## Scorecard summary

"General compute" is not one ecosystem — it spans cloud FaaS (AWS Lambda-class), decentralized compute markets (Golem-class), and TEE/confidential-compute markets. Each was checked individually; none currently passes:

| Candidate | Failing Q | Evidence |
|---|---|---|
| Cloud FaaS resale | Q8 | fiat billing, account-tiered, ToS typically prohibits resale |
| Decentralized compute markets | Q9, Q13 | protocol-internal matching (same shape as GPU.md); capex/ops to participate as provider |
| TEE / confidential compute markets | Q1 (specificity) | no verifiable named payer class with machine settlement found during this audit; UNKNOWN, not evaluated in depth |

**Verdict:** REJECT as a category. No single "compute adapter" is proposed; each candidate is tracked separately and only promoted individually if it passes all 13 questions on its own evidence.

## Reopen trigger

Per-candidate: any of the above shows a crawlable priced-supplier list plus a machine-settlement rail with no capex requirement to broker. TEE/confidential compute in particular is flagged UNKNOWN and worth a dedicated evaluation pass in a future quarter, not folded into this rejection by default.
