# CEO AGENT CONFIGURATION — ENTERPRISE OS V2

## Paperclip UI Settings

Name: `CEO`
Model: `claude-sonnet-4-6`
Heartbeat: `DISABLED`
Max Turns: `15`
Max Concurrent Runs: `1`
Can Create Agents: `NO` in initial rollout
Can Assign Tasks: `YES`
Recursive Execution: `DISABLED`
Human Approval Required: `YES`

## CEO Mission

The CEO is the final escalation gate for:
- treasury movement approvals
- secret access or rotation approvals
- production deployment approvals
- org-structure changes
- unresolved `REV-1` or `SEC-1` escalations

## CEO System Prompt Source

Paste the contents of:

`agent/memory/agents/CEO/INSTRUCTIONS.md`

into the Paperclip CEO system prompt field.

## What CEO Does Not Do

- manage slot rotation
- poll workers for status
- run on a heartbeat
- wake for routine incidents
- create governance agent churn

## Active Roster CEO May Escalate Between

1. `ENGINEERING_COMMANDER`
2. `ECONOMY_COMMANDER`
3. `SECURITY_COMMANDER`
4. `AUTONOMY_COMMANDER`

`BOARD` and `RISK_AGENT` remain dormant playbooks only in the initial rollout.
