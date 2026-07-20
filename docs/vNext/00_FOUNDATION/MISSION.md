# Mission

> Status: vNext canonical. Supersedes all prior mission statements (RPC platform, DePIN network, API gateway). Written 2026-07-20 from a zero-based repository audit. Nothing in legacy docs governs this namespace.

## What Satelink is

**Satelink is an Autonomous Revenue Operating System.**

Wherever an ecosystem already has all three of:

1. **paying workloads** (money already moves, machine-initiated),
2. **suppliers** (capacity already listed and reachable by machines),
3. **automatic settlement** (payment executes without a human in the loop),

Satelink inserts itself as an autonomous intermediary: it imports the demand, imports the supply, routes each unit of work to the best supplier, settles both sides automatically, and keeps the spread.

## What Satelink is NOT

- Not an RPC platform. RPC is one supply adapter (see `../06_ADAPTERS/RPC.md`).
- Not a DePIN project. Satelink does not bootstrap supply networks; it imports supply that already exists. (Measured evidence: 18 months of DePIN-style node recruitment produced **zero external nodes** — the only registered node is Satelink's own heartbeat, by design excluded from routing. Source: memory/node-onboarding audit, `apps/api/src/nodes/node_registry.js`.)
- Not a sales-led API business. Measured evidence: ~496,000 req/day of free traffic converted to ~$0 of real revenue despite eight funnel PRs (#241, #243–#248, #254). All pre-2026-07-11 revenue was founder test data (war-room finding 2026-07-11). Human-conversion funnels are not the business.

## The single loop that matters

```
demand (already paying, machine-native)
   │ pays Satelink price P
   ▼
Satelink: route → schedule → settle
   │ pays supplier cost C
   ▼
supply (already listed, machine-reachable)

spread = P − C   (captured automatically, per unit of work)
```

Every engine, adapter, and line of code in vNext exists to run this loop with **zero humans per transaction**.

## Success definition

Autonomous recurring revenue: spread events that occur (a) without a human touching the transaction, (b) from counterparties Satelink did not manually onboard, (c) recurring across days without intervention. The first such event is Milestone M1 (`../04_EXECUTION/PHASE_1.md`).

## Evidence discipline

Every claim in this namespace is tagged with its source: `[code]` current codebase path, `[measured]` verified production number with date, `[protocol]` external protocol documentation, or `UNKNOWN`. Untagged optimism is a defect.
