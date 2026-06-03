# SATELINK ENTERPRISE OS
# Status: Phase 1 shadow mode
# Updated: 2026-06-03

This directory is the new operating system for Satelink's Paperclip organization.

It replaces queue-first coordination with event-first coordination while preserving
the current queue files as compatibility artifacts during migration.

## Operating Principles

1. Revenue before task throughput
2. Security before convenience
3. Event ownership before slot rotation
4. Founder approvals only where risk requires them
5. Sleep after resolution

## Runtime Model

Active Paperclip roster in initial rollout:
- `CEO`
- `ENGINEERING_COMMANDER`
- `ECONOMY_COMMANDER`
- `SECURITY_COMMANDER`
- `AUTONOMY_COMMANDER`

Dormant governance playbooks:
- `BOARD`
- `RISK_AGENT`

Invoked role packs:
- `QA_COMMANDER`
- `DEPLOYMENT_COMMANDER`
- `SRE_COMMANDER`
- `DEMAND_COMMANDER`
- `CONVERSION_COMMANDER`
- `RETENTION_COMMANDER`
- `TREASURY_GUARDIAN`
- `RED_TEAM`
- `BLUE_TEAM`

## Files

- `ORG_STRUCTURE.md` — division ownership and dormant governance rules
- `EVENT_BUS.md` — event-handling laws and token-efficiency controls
- `REVENUE_SEVERITY_LEVELS.md` — `REV-1` through `REV-4` revenue prioritization
- `PHASE_0_REVENUE_VALIDATION.md` — revenue-truth gate before cutover
- `CUSTOMER_ZERO_PROGRAM.md` — first paying machine/protocol customer program
- `REVENUE_FUNNEL_ANALYTICS.md` — funnel stages, events, and metrics
- `ESCALATION_PATHS.md` — fixed escalation trees
- `FOUNDER_DASHBOARD_KPIS.md` — founder-visible metric contract
- `RISK_AND_COST.md` — waste baseline and token-control policy
- `AUTOMATION_BACKLOG.md` — founder-action capture queue for automation

## Shadow Mode Rule

Until Phase 3 authority switch:
- `agent/memory/MASTER_TASK_QUEUE.md` remains readable for compatibility.
- `agent/memory/PROGRESS.md` remains the legacy history file.
- `agent/memory/events/ACTIVE_EVENTS.md` and `RESOLUTION_LOG.md` become the new
  event mirror and future source of authority.

## Exit Condition For This Directory

The queue can be frozen only after:
- revenue truth is validated,
- a `REV-1` incident can be routed without CEO polling,
- and commander ownership resolves events through the event log alone.
