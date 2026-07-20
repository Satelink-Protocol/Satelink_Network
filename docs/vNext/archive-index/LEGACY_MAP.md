# Legacy Map

> Read-only index of pre-vNext documents and code. Nothing here is edited, renamed, or deleted by vNext work. Nothing here governs vNext decisions — this map exists so nobody has to re-read legacy docs to know what they were.
>
> Inventory basis: 88 markdown files under `docs/`, 8 at repo root, plus `.claude/CLAUDE.md` [counted 2026-07-20].

## Status legend

- **OPERATIVE** — still governs live production operations; vNext must not contradict it operationally.
- **HISTORICAL** — accurate record of something that happened; useful evidence, no forward authority.
- **OBSOLETE** — describes a direction vNext abandons; keep for archaeology only.
- **UNKNOWN** — not re-verified during the 2026-07-20 audit.

## Root documents

| Document | Status | Note |
|---|---|---|
| `CLAUDE.md` (→ `.claude/CLAUDE.md`) | OPERATIVE | Production state, guards, deploy mechanism. Its *identity* section ("machine-commerce RPC gateway") is superseded by `../00_FOUNDATION/MISSION.md`; its *operational rules* remain binding. |
| `AUDIT_REPORT_2026_06.md` | HISTORICAL | June 2026 audit; superseded by `../03_ENGINEERING/CODE_AUDIT.md` for vNext purposes. |
| `REVENUE_BLOCKER_MATRIX.md` | HISTORICAL | Pre-pivot revenue analysis; its core finding (conversion is the problem) feeds First Principle #1. |
| `PROGRESS.md`, `CURRENT_TASK.md` | OBSOLETE | Session scratch from prior directions. |
| `FABLE5_UI_GODMODE.md` | HISTORICAL | UI token-system rules (PR #214); still applies to `apps/web` work. |
| `README.md`, `CONTRIBUTING.md` | OPERATIVE | Public-facing; will need a vNext rewrite *as a new PR*, not an edit under this reset. |

## docs/ — operative

| Document | Status | Note |
|---|---|---|
| `docs/OPERATIONS.md`, `docs/DEVOPS_RUNBOOK.md` | OPERATIVE | Runbooks for the live Railway deployment. |
| `docs/SECURITY.md` | OPERATIVE | Includes the deliberate decision not to blanket-sweep console.log. |
| `docs/ADMIN_DASHBOARD.md` | OPERATIVE | 18 observer endpoints, live [measured 2026-07-16]. |
| `docs/API_REFERENCE.md` | OPERATIVE for legacy surface | vNext endpoints will be documented under vNext, not here. |

## docs/ — historical evidence (feeds vNext market validation)

| Document | Status | Note |
|---|---|---|
| `docs/x402-bazaar-escalation.md` | HISTORICAL | Proof of mainnet x402 settlements + Bazaar indexing facts. Primary evidence for `../02_MARKET_VALIDATION/PAYING_ECOSYSTEM_SCORECARD.md`. |
| `docs/audit-2026-06-13/`, `docs/audit-2026-06-21-customer-zero/` | HISTORICAL | Phantom-revenue and billing-disconnect audits. Evidence for First Principles #1, #6. |
| `docs/DATA_TRUTH_AUDIT.md` | HISTORICAL | Fabricated-data inventory. |
| `docs/PRICING_INTELLIGENCE.md` | HISTORICAL | Advisory pricing engine (PR #242); code is reused by vNext Pricing Engine. |
| `docs/monitoring/` (Grafana option-B package) | HISTORICAL | Design-only monitoring pivot; unbuilt. |

## docs/ — obsolete directions (vNext explicitly abandons)

| Document | Status | Abandoned because |
|---|---|---|
| `docs/NODE_OPERATOR_GUIDE.md`, `NODE_OPERATOR_QUICKSTART.md`, `node-operators.md` | OBSOLETE | DePIN supply recruitment produced zero external nodes [code: node_registry self-heartbeat only]. vNext imports supply; it does not recruit it. |
| `docs/CUSTOMER_ZERO.md`, `PAID_TIER_QUICKSTART.md`, `MACHINE_ONBOARDING.md` | OBSOLETE | Human-onboarding funnel strategy; measured conversion ~zero. Machine flows only in vNext. |
| `docs/GOVERNANCE_ZONES.md` | OBSOLETE | Governance ambitions with no live counterpart. |
| `docs/outreach/` | OBSOLETE | Outreach-led growth rejected (also: cold-emailing inferred addresses was explicitly rejected by founder). |
| `docs/CHAINLIST_SUBMISSION.md`, `chainlist_mainnet_pr.md`, `DRPC_SUBMISSION.md` | HISTORICAL | Free-traffic acquisition channels; they worked (496k req/day) but acquire non-paying demand. |
| `docs/erpc-adapter/` | UNKNOWN | Not re-verified this audit. |
| `docs/executive/`, `docs/prs/`, `docs/architecture/` | UNKNOWN | Mixed-era content; treat as historical until individually re-verified. |

## Code (summary — full detail in `../03_ENGINEERING/CODE_AUDIT.md`)

| Area | Status |
|---|---|
| `apps/api/app_factory.mjs` + mounted routers | OPERATIVE (the live product) |
| Top-level `src/` (24 files), `core/` (12), `services/` (10), `agents/`, `utils/`, root `app_factory.mjs`, `server.shim.current.js`, `node_heartbeat.js` | OBSOLETE orphan roots — not imported by the live app [verified: live server imports `apps/api/app_factory.mjs`] |
| `contracts/` | FROZEN — never modified without explicit instruction |
| `agent/memory/` | OPERATIVE — persistent agent state, never delete |
