# Adapter: Video (Transcoding / Streaming)

- **Status:** REJECTED (2026-07-20)
- **Kind:** Workload adapter (candidate)

## Scorecard summary

| # | Answer |
|---|---|
| 1 | YES — streaming platforms pay transcode/delivery networks (Livepeer-class) [protocol docs] |
| 9 | NO — Livepeer-class networks internalize orchestrator selection/routing as protocol economics; a reseller adds no measurable efficiency over the protocol's own routing |
| 11 | NO — no efficiency gain identified (price, latency, availability, or discovery) beyond what the protocol already provides |
| 13 | NO — operating orchestrator/transcode capacity to participate as a supplier is capex/ops beyond existing resources |
| **Verdict** | REJECT |

## Reopen trigger

Per-job, machine-settled transcode offers from listed third-party suppliers become available outside protocol-internal orchestrator routing (i.e., a genuine reseller opportunity, not a re-implementation of the protocol's own matching).

## Rationale note

This is the weakest candidate evaluated: it fails both the "vacant seat" test (Q9) and the "we add efficiency" test (Q11) simultaneously, with no near-term signal suggesting either changes. Lowest priority on the watchlist.
