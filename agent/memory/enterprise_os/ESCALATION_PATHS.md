# ESCALATION PATHS

## Core Rule

Escalation happens only when:
- the current owner cannot resolve the event inside scope,
- approval is required,
- or severity increases.

## Revenue Critical

`REV-1`
- `ECONOMY_COMMANDER` or `SECURITY_COMMANDER` owns first response
- if treasury, secret, or trust boundary is involved, `SECURITY_COMMANDER` leads
- escalate to `CEO` immediately if:
  - production approval is required
  - treasury action is required
  - recurring deposits are blocked with live customer impact

## Deployment Failure

`deployment.failed`
- owner: `ENGINEERING_COMMANDER`
- load `DEPLOYMENT_COMMANDER` playbook first
- if release quality is uncertain, also load `QA_COMMANDER`
- if security symptoms exist, route parallel review request to
  `SECURITY_COMMANDER` loading `BLUE_TEAM`

## Runtime Incident

`incident.api_down` affecting paid traffic
- owner: `ENGINEERING_COMMANDER`
- load `SRE_COMMANDER`
- escalate to `CEO` if active revenue is blocked or resolution needs approval

## Treasury Risk

`treasury.risk`
- owner: `SECURITY_COMMANDER`
- load `TREASURY_GUARDIAN`
- escalate to `CEO` for any movement, freeze, or approval decision

## Founder Manual Step

`founder.manual_step`
- owner: `AUTONOMY_COMMANDER`
- classify as:
  - `automate_now`
  - `needs_guardrail`
  - `accepted_manual_exception`
- route implementation work to the owning commander only if actual system work is
  required

## Dormant Governance

`BOARD` and `RISK_AGENT` remain dormant in initial phases.
They appear only as future governance escalation endpoints and are never woken
for routine delivery or monitoring.
