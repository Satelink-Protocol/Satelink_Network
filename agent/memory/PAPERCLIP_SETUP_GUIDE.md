# PAPERCLIP SETUP GUIDE — ENTERPRISE OS V2
# Configure these agents in Paperclip UI
# Status: Phase 1 shadow mode

## Purpose

This guide replaces the rotational queue setup with a 5-agent event-driven
roster while preserving the legacy queue files during migration.

## Active Agents To Configure

### CEO
- Name: `CEO`
- Model: `claude-sonnet-4-6`
- Heartbeat: `DISABLED`
- Max Turns: `15`
- Max Concurrent Runs: `1`
- Can Assign Tasks: `YES`
- Can Create Agents: `NO` in initial rollout

System prompt source:
- `agent/memory/agents/CEO/INSTRUCTIONS.md`

### ENGINEERING_COMMANDER
- Name: `ENGINEERING_COMMANDER`
- Model: `claude-sonnet-4-6`
- Heartbeat: `DISABLED`
- Max Turns: `20`
- Can Assign Tasks: `NO`
- Can Create Agents: `NO`

System prompt source:
- `agent/memory/agents/ENGINEERING_COMMANDER/INSTRUCTIONS.md`

### ECONOMY_COMMANDER
- Name: `ECONOMY_COMMANDER`
- Model: `claude-sonnet-4-6`
- Heartbeat: `DISABLED`
- Max Turns: `20`
- Can Assign Tasks: `NO`
- Can Create Agents: `NO`

System prompt source:
- `agent/memory/agents/ECONOMY_COMMANDER/INSTRUCTIONS.md`

### SECURITY_COMMANDER
- Name: `SECURITY_COMMANDER`
- Model: `claude-sonnet-4-6`
- Heartbeat: `DISABLED`
- Max Turns: `20`
- Can Assign Tasks: `NO`
- Can Create Agents: `NO`

System prompt source:
- `agent/memory/agents/SECURITY_COMMANDER/INSTRUCTIONS.md`

### AUTONOMY_COMMANDER
- Name: `AUTONOMY_COMMANDER`
- Model: `claude-sonnet-4-6`
- Heartbeat: `DISABLED`
- Max Turns: `15`
- Can Assign Tasks: `NO`
- Can Create Agents: `NO`

System prompt source:
- `agent/memory/agents/AUTONOMY_COMMANDER/INSTRUCTIONS.md`

## Dormant Governance

Do not provision `BOARD` or `RISK_AGENT` as active runtime agents in the
initial rollout. Keep them as playbooks only.

## Legacy Queue Compatibility

During Phases 0-2:
- preserve `agent/memory/MASTER_TASK_QUEUE.md`
- preserve `agent/memory/PROGRESS.md`
- preserve legacy worker instruction files

But do not configure the old queue model as the primary operating system.

## Runtime Files To Use

Primary operating files:
- `agent/memory/events/ACTIVE_EVENTS.md`
- `agent/memory/events/RESOLUTION_LOG.md`
- `agent/memory/events/EVENT_ROUTING.md`
- `agent/memory/enterprise_os/REVENUE_SEVERITY_LEVELS.md`
- `agent/memory/enterprise_os/ESCALATION_PATHS.md`

Reference operating files:
- `agent/memory/enterprise_os/PHASE_0_REVENUE_VALIDATION.md`
- `agent/memory/enterprise_os/CUSTOMER_ZERO_PROGRAM.md`
- `agent/memory/enterprise_os/REVENUE_FUNNEL_ANALYTICS.md`
- `agent/memory/enterprise_os/FOUNDER_DASHBOARD_KPIS.md`
- `agent/memory/enterprise_os/AUTOMATION_BACKLOG.md`

## Activation Rules

- No agent wakes on a timer
- No queue slot scheduling
- One open event has one owner
- CEO wakes only for approvals or unresolved escalations
- Commanders load role packs from `agent/memory/roles/` as needed

## Shadow Mode Rollout

1. Create the 5 active agents
2. Paste the corresponding instruction files into their system prompts
3. Keep old queue files intact
4. Mirror live work into `ACTIVE_EVENTS.md` and `RESOLUTION_LOG.md`
5. Do not freeze the queue until Phase 3 exit criteria are met
