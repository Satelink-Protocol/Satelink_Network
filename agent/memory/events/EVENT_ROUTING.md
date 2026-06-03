# EVENT ROUTING

## Primary Routing Contract

- `deployment.*` -> `ENGINEERING_COMMANDER`
- `qa.*` -> `ENGINEERING_COMMANDER`
- `incident.*` -> `ENGINEERING_COMMANDER`
- `sre.*` -> `ENGINEERING_COMMANDER`
- `revenue.*` -> `ECONOMY_COMMANDER`
- `customer.*` -> `ECONOMY_COMMANDER`
- `funnel.*` -> `ECONOMY_COMMANDER`
- `cost.*` -> `ECONOMY_COMMANDER`
- `security.*` -> `SECURITY_COMMANDER`
- `treasury.*` -> `SECURITY_COMMANDER`
- `secret.*` -> `SECURITY_COMMANDER`
- `founder.action_taken` -> `AUTONOMY_COMMANDER`

## Role Pack Loading Rules

### ENGINEERING_COMMANDER
- load `QA_COMMANDER` for release-quality verification
- load `DEPLOYMENT_COMMANDER` for deploy, rollback, or release routing
- load `SRE_COMMANDER` for uptime, observability, and incident containment

### ECONOMY_COMMANDER
- load `DEMAND_COMMANDER` for top-of-funnel and wallet identification
- load `CONVERSION_COMMANDER` for deposit and first-paid-call conversion
- load `RETENTION_COMMANDER` for recurring deposits and churn prevention

### SECURITY_COMMANDER
- load `TREASURY_GUARDIAN` for treasury integrity
- load `BLUE_TEAM` for defense, containment, or deployment review
- load `RED_TEAM` for adversarial challenge or pre-release attack thinking

## Escalation To CEO

Escalate only when:
- the event is cross-division and unresolved,
- approval is required,
- or severity is `REV-1` / `SEC-1` and cannot be contained by the owner.

## Dormant Governance Rule

`BOARD` and `RISK_AGENT` are not activated in initial phases unless an explicit
governance file or future threshold policy requires them.
