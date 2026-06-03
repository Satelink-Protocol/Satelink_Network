# AUTOMATION BACKLOG
# Owner: AUTONOMY_COMMANDER

Every founder action must eventually become one of the entries below.

## Status Buckets

### `automate_now`
Manual founder action that is repeatable, safe to automate, and blocked only by
implementation work.

### `needs_guardrail`
Action can be automated, but only after explicit approval checks, limits, or
security boundaries exist.

### `accepted_manual_exception`
Action should remain manual for now because automation would create more risk
than leverage.

## Entry Format

```md
| Date | Founder Action | Trigger Event | Classification | Owning Commander | Guardrail Needed | Success Metric | Status |
```

## Initial Table

| Date | Founder Action | Trigger Event | Classification | Owning Commander | Guardrail Needed | Success Metric | Status |
|------|----------------|---------------|----------------|------------------|------------------|----------------|--------|
| 2026-06-03 | Produce daily revenue truth summary | `founder.action_taken` | needs_guardrail | ECONOMY_COMMANDER | Cash-source validation | Summary produced without manual query stitching | OPEN |
| 2026-06-03 | Decide whether an alert merits escalation | `founder.action_taken` | automate_now | SECURITY_COMMANDER | No | Duplicate alert rate reduced | OPEN |
