# Adapter: GPU

- **Status:** REJECTED (2026-07-20)
- **Kind:** Workload adapter (candidate)

## Scorecard summary

| # | Answer |
|---|---|
| 1 | YES — ML teams pay GPU networks (Akash, io.net, Vast.ai) [protocol docs] |
| 4 | NO — these networks internalize matching/bidding as the protocol itself; a reseller sits either as a bidding deployer (must operate/rent capacity, capex) or is structurally redundant with the protocol's own auction |
| 9 | NO given above — no vacant router/spread seat; the seat is occupied by the protocol's auction mechanism |
| 13 | Marginal — GPU brokering requires deployment operations expertise and capital this team does not have (repo evidence: `mev_relay`-class latency/capital experiments in this repo produced zero revenue [code audit]) |
| **Verdict** | REJECT |

## Reopen trigger

A GPU network exposes a genuine third-party broker/reseller API with native machine settlement and no capex requirement (i.e., resale of *listed* idle capacity, not operated deployments) — OR GPU compute offers appear priced and listed as x402-class merchants.

## Rationale note

This is the clearest example of Q9 ("vacant seat?") doing its job: GPU markets already have a router (the protocol). Inserting Satelink would either duplicate that function uselessly or require becoming a capital-intensive participant, which contradicts First Principle #2 (do not create markets; tax existing flows) since there is no flow to tax without becoming an operator.
