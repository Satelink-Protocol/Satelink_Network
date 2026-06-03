# EVENT SCHEMA

## Canonical Event Envelope

```text
EVENT | id=EVT-* | type=* | severity=* | source=* | subject=* | owner=* | status=NEW | dedupe_key=* | timestamp=*
```

## Canonical Resolution Envelope

```text
RESOLUTION | event_id=* | owner=* | outcome=resolved|escalated|accepted_risk|approval_required | next_owner=* | timestamp=*
```

## Required Fields

- `id` — stable event identifier
- `type` — event family such as `revenue.deposit_failed`
- `severity` — `REV-*`, `SEC-*`, or `OPS-*`
- `source` — where the event originated
- `subject` — wallet, deployment, service, treasury, customer, or system target
- `owner` — accountable commander
- `status` — current lifecycle state
- `dedupe_key` — key used to suppress duplicate wakeups
- `timestamp` — ISO timestamp

## Status Lifecycle

- `NEW`
- `ACKED`
- `ACTIVE`
- `BLOCKED_APPROVAL`
- `RESOLVED`
- `ESCALATED`
- `ACCEPTED_RISK`

## Ownership Rules

- One open event has one owner.
- Severity may rise without changing the event id.
- Ownership may change only through a `RESOLUTION` line.

## Examples

```text
EVENT | id=EVT-REV-001 | type=revenue.validation.required | severity=REV-1 | source=enterprise_os.phase0 | subject=revenue_truth | owner=ECONOMY_COMMANDER | status=ACTIVE | dedupe_key=phase0-revenue-truth | timestamp=2026-06-03T00:00:00Z
```

```text
RESOLUTION | event_id=EVT-OPS-001 | owner=ENGINEERING_COMMANDER | outcome=resolved | next_owner=NONE | timestamp=2026-06-03T00:00:00Z
```
