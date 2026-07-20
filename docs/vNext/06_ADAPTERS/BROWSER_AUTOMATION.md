# Adapter: Browser Automation

- **Status:** REJECTED (2026-07-20)
- **Kind:** Workload adapter (candidate)

## Scorecard summary

| # | Answer |
|---|---|
| 1 | YES — agent frameworks pay browser-automation/scraping APIs (Browserbase-class, scraping-API vendors) [public pricing]; volume UNKNOWN |
| 3 | PARTIAL — pricing is often account-tiered (per-seat/per-plan) rather than pure per-call, complicating clean per-unit resale |
| 8 | NO (dominant path) — fiat API keys, not machine-settled |
| 13 | PARTIAL — several providers' terms restrict resale (not individually verified in this audit; flagged for per-provider legal check before any admission) |
| **Verdict** | REJECT under current dominant distribution |

## Reopen trigger

Browser-automation/scraping merchants appear on a crawlable machine-settled index (x402 or equivalent) with terms that are verified (not assumed) resale-permissive.

## Rationale note

Strong agent-native demand is plausible here (agents routinely need to browse/scrape), which is why this is tracked rather than dismissed outright, but two separate blockers stack: no machine rail today, and unverified resale terms even where pricing exists. Both must clear before admission — this adapter needs a per-provider terms-of-service check as part of any future scorecard, not just a rail check.
