# RISK AND COST BASELINE

## Why This Change Exists

The current queue architecture burns tokens by repeatedly asking whether work is
done instead of waking only when conditions change.

## Observed Waste In Current Logs

From `agent/memory/PROGRESS.md` and alert logs:

- 10 consecutive `FRONTEND_WORKER` stale-session runs with 0 tokens
- 200+ harness retries recorded on `SAT-189` for a single queue-check outcome
- 11 duplicate SENTINEL silence false positives for the same completed run
- repeated `QUEUE_CHECK: no action needed` entries for long-running slots
- a 3-turn SENTINEL job that stalled long enough to require retry issue
  recreation

These are classic queue-polling and retry-churn symptoms.

## Cost Controls

- Active roster capped at 5 agents in the initial rollout
- `BOARD` and `RISK_AGENT` remain dormant to avoid routine governance spend
- No periodic wakeups
- No duplicate wakeups inside the quiet window
- No cross-division wakeups unless routing contract requires them

## Operational Risk Controls

- Treasury, secret, and production deployment approvals remain human-gated
- Revenue truth must be cash-first before authority migration
- One owner per event prevents diffusion of accountability
- Role packs preserve specialization without increasing active agent count

## Success Criteria

- fewer no-op wakeups
- fewer duplicate alerts
- no CEO scheduler polling
- faster escalation on cash-impact incidents
