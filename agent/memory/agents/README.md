# SATELINK AGENT ROSTER — ENTERPRISE OS V2
# Status: Phase 1 shadow mode

## Active Paperclip Roster

These are the only always-available agents in the initial rollout:

- `CEO` — final escalation gate and approval owner
- `ENGINEERING_COMMANDER` — engineering, QA, deployment, and SRE owner
- `ECONOMY_COMMANDER` — revenue, customer, and funnel owner
- `SECURITY_COMMANDER` — treasury, secrets, and adversarial owner
- `AUTONOMY_COMMANDER` — founder-independence owner

## Dormant Governance

These remain playbooks only in the initial rollout:

- `BOARD`
- `RISK_AGENT`

They are not routine runtime agents and should not consume tokens unless a
future governance threshold explicitly activates them.

## Role Packs

These files exist for commanders to load on demand, not as always-on agents:

- `QA_COMMANDER`
- `DEPLOYMENT_COMMANDER`
- `SRE_COMMANDER`
- `DEMAND_COMMANDER`
- `CONVERSION_COMMANDER`
- `RETENTION_COMMANDER`
- `TREASURY_GUARDIAN`
- `RED_TEAM`
- `BLUE_TEAM`

## Legacy Compatibility Agents

The previous queue-era agents remain in this directory during shadow mode:

- `BACKEND_WORKER`
- `FRONTEND_WORKER`
- `GROWTH_WORKER`
- `ORCHESTRATOR`
- `CONVERSION_MONITOR`
- `SENTINEL`

They are compatibility artifacts while the queue is still preserved.
They are not the target operating model.

## Operating Law

- One open event has one owner.
- No slot rotation.
- No routine wakeups.
- No CEO polling.
- Collected cash outranks task throughput.
