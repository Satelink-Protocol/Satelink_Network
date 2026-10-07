# workers/trading-bots — automation bot runner (Phase 6 item 10)

Separate worker process for every scheduled and event-driven trading bot (library:
`apps/api/src/trading_agent/bots/`). Pattern from `workers/reconciler`: self-scheduling loop per bot,
no overlap, fail-open, health endpoint.

**Not deployed.** There is no Railway service for it and no `railway.json` on purpose: creating the
service (in a staging environment first, B-06) is a founder action. Locally:

```bash
PORT=8081 node workers/trading-bots/src/index.mjs   # every bot: skipped_flag (TRADING_AGENT off) / not_configured
curl localhost:8081/health ; curl localhost:8081/metrics
```
