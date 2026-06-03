# REVENUE SEVERITY LEVELS

Revenue severity determines who wakes first, how fast they respond, and when
the event must escalate to `CEO`.

## REV-1 Critical

Definition:
- collected USDT blocked
- treasury mismatch
- payment path failure
- recurring deposits stop
- machine customer outage with active revenue loss

Primary owner:
- `ECONOMY_COMMANDER` for customer or payment-flow issues
- `SECURITY_COMMANDER` for treasury or trust-boundary issues

Response SLA:
- immediate acknowledgement
- active investigation same session

Escalation:
- escalate to `CEO` if not resolved or formally contained in one commander run
- escalate immediately if founder approval is required

CEO notification:
- always

## REV-2 High

Definition:
- conversion path broken
- active payer unable to upgrade
- sharp revenue-per-hour drop
- customer zero at risk

Primary owner:
- `ECONOMY_COMMANDER`

Response SLA:
- acknowledge same wake
- resolve or escalate within the same operating window

Escalation:
- escalate to `CEO` if customer zero or active payer remains blocked after
  commander action

CEO notification:
- yes when payer or customer zero is directly affected

## REV-3 Medium

Definition:
- funnel degradation
- wallet activation slowdown
- deposit latency increase
- cash conversion decline

Primary owner:
- `ECONOMY_COMMANDER`

Response SLA:
- investigate in next relevant wake

Escalation:
- escalate only if trend persists across two confirmed event occurrences

CEO notification:
- no, unless linked to a larger `REV-1` or `REV-2` condition

## REV-4 Low

Definition:
- insight-only anomalies
- attribution gaps
- dashboard mismatch without cash impact

Primary owner:
- `ECONOMY_COMMANDER`

Response SLA:
- batch into analytics or backlog work

Escalation:
- none by default

CEO notification:
- no

## Classification Notes

- Metered value alone does not create `REV-1`.
- Collected cash and customer impact outrank usage counts.
- If treasury safety is in doubt, classify as both revenue and security and
  hand first ownership to `SECURITY_COMMANDER`.
