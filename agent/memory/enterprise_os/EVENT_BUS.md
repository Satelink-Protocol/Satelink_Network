# EVENT BUS OPERATING LAW

## Purpose

The event bus is the coordination layer for Satelink Enterprise OS.
It exists to wake agents only when cash, customers, security, cost, or uptime
actually change.

## Wake Triggers

Agents may wake only for:
- `deployment.*`
- `incident.*`
- `revenue.*`
- `customer.*`
- `funnel.*`
- `security.*`
- `treasury.*`
- `secret.*`
- `cost.*`
- `founder.action_taken`

## Hard Rules

1. No hourly loops
2. No routine cron wakeups
3. No polling-based queue checks
4. One active owner per event
5. Dedupe identical alerts inside the quiet window
6. Sleep immediately after:
   - resolution
   - escalation
   - approval block
   - accepted risk decision

## Quiet Window

Default dedupe quiet window: 30 minutes.

Events with the same `dedupe_key` inside that window:
- do not create a new wakeup,
- append evidence to the existing event,
- and preserve the current owner unless severity increases.

## Severity Namespaces

- Revenue events use `REV-1` to `REV-4`
- Security events may use `SEC-1` to `SEC-4`
- Engineering/runtime events may use `OPS-1` to `OPS-4`

## Approval Boundaries

Automatic execution is blocked for:
- treasury movement
- secret access or rotation
- production deployment approval
- org-structure changes

These events end in `approval_required` and escalate to `CEO`.

## Shadow Mode Behavior

During Phases 0-2:
- `ACTIVE_EVENTS.md` mirrors the new operating model
- `PROGRESS.md` remains the legacy execution record
- queue files are readable but are no longer the design source of truth

## Forbidden Patterns

- waking `CEO` for routine status checks
- waking multiple commanders for the same unscoped alert
- waking `BOARD` or `RISK_AGENT` for normal incidents
- spawning monitoring cycles that exist only to ask whether something changed
