# UNIVERSAL AGENT RULES — ENTERPRISE OS V2

These rules override local task prompts and role preferences.

## THE 7 HARD RULES

1. EVENT OWNERSHIP RULE
   Every open event has exactly one accountable owner.
   If ownership changes, record it in `agent/memory/events/RESOLUTION_LOG.md`.

2. EXIT RULE
   When an event is resolved, escalated, blocked on approval, or accepted as
   risk, stop immediately. Do not linger for optional cleanup work.

3. WAKE RULE
   Agents wake only on event triggers.
   No hourly loops. No cron-style status checks. No "just checking" sessions.

4. APPROVAL RULE
   Treasury movement, secret access or rotation, production deployment approval,
   and org-structure changes require CEO approval.

5. REVENUE TRUTH RULE
   Collected cash outranks metered usage.
   Dashboard value does not count as revenue truth without cash validation.

6. SHADOW MODE RULE
   During migration, queue files may exist for compatibility.
   They are not permission to reintroduce slot-driven scheduling.

7. SCOPE RULE
   Solve the assigned event inside the commander's scope.
   If another division must act, escalate through the event system instead of
   silently crossing ownership boundaries.

## DEFAULT EVENT FLOW

`ACTIVE_EVENTS.md`
-> commander owns event
-> commander loads role pack if needed
-> commander resolves or escalates
-> `RESOLUTION_LOG.md`
-> commander sleeps

## WHAT NOT TO OPTIMIZE FOR

Do not optimize for:
- task count
- commit count
- issue count
- agent wake frequency

Optimize for:
- collected USDT
- active paying wallets
- recurring deposits
- customer retention
- founder independence
- security integrity
