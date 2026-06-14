# LEAD QUALITY REPORT — Who Is The Traffic?

**Date:** 2026-06-13. Source: live `/system/free-tier` (reads Redis `ft:*`) + free_tier_gate.js code.

## HEADLINE: The traffic is bot/scanner-scale, not developer leads.

The audit brief assumed "445 active IPs." **Reality: 1121 active IPs**, and the top "leads" are making **hundreds of thousands of calls each** — far outside any human-developer profile.

## LIVE DATA (`GET /system/free-tier`, 2026-06-13 ~08:34 UTC)

```
activeIPs:    1121
totalCalls:   609,954
nearLimitIPs: 66      (>80% of the 500/day limit)
limit:        500
```

### Top conversion targets (hashed IPs, `calls_today`)

| Hashed IP | calls_today | % of 500 limit |
|---|---|---|
| IP-bf559ae91327 | **206,888** | 41,378% |
| IP-02022e2b32fd | **154,536** | 30,907% |
| IP-ab4f13924f99 | 49,466 | 9,893% |
| IP-61c66661c26f | 49,039 | 9,808% |
| IP-bcfc168ae8ad | 21,667 | 4,333% |

## INTERPRETATION (with mechanism evidence)

- A single IP at **206,888 calls/day** is not a developer dApp — that's an automated scanner, indexer, or a misconfigured retry loop. Two IPs alone account for **~361k of the 610k total calls (59%)**.
- These IPs are **over the free limit by 100–400×** yet still appear as active counters. Mechanism (`free_tier_gate.js:106-108` comment + `:76`): blocked requests still call `redis.incr`, so the counter keeps climbing on rejected calls. **High call counts = blocked-attempt volume, not served traffic** — i.e., these clients ignore the 402 and keep hammering. This is the exact pathology the 402-vs-429 fix (PR `82d8339`) was meant to reduce, and it is still occurring.
- **Redis quota exhaustion (operational finding):** Upstash REST returned `ERR max requests limit exceeded. Limit: 500000, Usage: 500000` for today. The 610k+ free-tier `incr` calls are exhausting the Redis daily quota. When Redis errors, `free_tier_gate.js:82-88` falls back to **per-instance in-memory counters** — which reset on redeploy and don't share state across replicas, making rate limiting unreliable and letting heavy IPs slip through (consistent with the over-limit test being served 200).

## TRAFFIC-METHOD CLASSIFICATION — BLOCKED BY OBSERVABILITY GAP

Cannot classify by RPC method from here:
- No production DB access (local PG down; no prod connection string).
- `revenue_events_v2.method` column was **never written** by `recordRpcRevenue` (original code) — so even with DB access, method distribution was unrecoverable for the main billing path. The node path stored it only inside `op_type` as `rpc_<method>`.
- This audit's Phase-7 fix (writing `chain, method, source` into the INSERT) means *future* traffic becomes classifiable, but historical method data is gone.

## VERDICT

**Infrastructure noise, not developer demand.** 1121 IPs, but volume is dominated by a handful of scanner-class clients ignoring the paywall. "66 near-limit IPs" is the only marginally interesting cohort — IPs near (not 400× over) the limit are the realistic conversion candidates. None have converted: 0 deposits (see REVENUE_PATH_AUDIT). The "conversion_targets" table (PR #115) is seeded from these counters, so its lead quality inherits this noise.
