# Production launch readiness: Trading Agent

> **Decision: NO-GO.** Reviewed 2026-10-06 by Claude Code (read-only; no flag changed, nothing deployed). No gate is signed, and Gates 1–5, 8 and 9 aren't defined in the repository. **Only the founder can sign a go/no-go** (section 8).

## 1. State separation per broker

A state is shown as reached only with evidence. Order: IMPLEMENTED → TESTED → PAPER-VALIDATED → PARTNER-APPROVED → PRODUCTION-ENABLED → REAL-REVENUE-VERIFIED.

| Broker | IMPLEMENTED | TESTED | PAPER-VALIDATED | PARTNER-APPROVED | PRODUCTION-ENABLED | REAL-REVENUE-VERIFIED |
|---|---|---|---|---|---|---|
| Binance | **yes**: `brokers/binance/**`, PR #476 | **yes**, against a fake venue: `trading_binance_adapter.test.js`; testnet acceptance test not run (no credentials) | **no**: Gate 6 not met (needs 5 nightly testnet runs) | **no**: UNVERIFIED (`partners/partners.json`, #486) | **no**: `LIVE_TRADING` locked; nothing on `main` | **no**: nothing to verify (#488) |
| Upstox | **yes**: `brokers/upstox/**`, #477 | **yes**, fake venue: `trading_upstox_copilot.test.js`; sandbox test not run | **no**: no paper-validation path defined | **no**: UNVERIFIED | **no** | **no** |
| Alpaca | **yes**: `brokers/alpaca/**`, #478 | **yes**, fake venue: `trading_alpaca_broker.test.js`; sandbox test not run | **no**: no paper-validation path defined | **no**: UNVERIFIED | **no** | **no** |

Each "yes" is backed only by code and mocked-venue tests in unmerged draft PRs. No real sandbox, testnet or broker has been exercised.

## 2. Gates

| Gate | Definition (source) | Status | Evidence |
|---|---|---|---|
| Gate 0 | every blocker in the register RESOLVED (`BLOCKERS.md`) | **NOT MET** | B-01 to B-06, B-08, B-09, B-11 OPEN; B-07, B-10 PARTIAL; B-12 RESOLVED |
| Gate 1 | **UNDEFINED** in the repository | **UNDEFINED** | founder to supply the definition |
| Gate 2 | **UNDEFINED** | **UNDEFINED** | founder to supply |
| Gate 3 | **UNDEFINED** | **UNDEFINED** | founder to supply |
| Gate 4 | **UNDEFINED** | **UNDEFINED** | founder to supply |
| Gate 5 | **UNDEFINED** | **UNDEFINED** | founder to supply |
| Gate 6 | 5 consecutive green nightly runs: paper loop + Binance testnet (Stage 30) | **NOT MET** | the nightly workflow isn't on `main`; `trading-testnet` secrets don't exist |
| Gate 7 | security hardening: KMS, DB roles, static egress, CI scans, daily key check, admin step-up, rotated secrets (Stage 31 G1-03) | **NOT MET** | Stage 28 paused on its KMS STOP |
| Gate 8 | **UNDEFINED** | **UNDEFINED** | founder to supply |
| Gate 9 | **UNDEFINED** | **UNDEFINED** | founder to supply |
| REAL MONEY GATE 1 | `gates/real-money-gate-1.md` (#485) | **CLOSED, unsigned** | 9 items PENDING-HUMAN; no `approvals.json` |
| REAL REVENUE GATE 1 | `evidence/first-real-revenue.md` (#488) | **NOT VERIFIED** | no real trade; live billing not approved |

REAL MONEY GATE 1 and REAL REVENUE GATE 1 are not mapped onto gate numbers here: that mapping is the founder's to state.

## 3. Go/no-go items

| # | Item | Status | Evidence / why |
|---|---|---|---|
| 1 | All gates signed | **NO-GO** | section 2 |
| 2 | Full CI green on the release commit | **NO-GO** | below: suites pass, but full runs flake |
| 3 | Code merged to `main` and deployed via staging | **NO-GO** | stack #464–#488 unmerged drafts; no staging (B-06); API unregistered (Option A) |
| 4 | Rollback drill performed in staging | **NO-GO** | **not performed**: no staging environment; procedure in section 6 |
| 5 | Flags plan approved | **NO-GO** | proposed in section 4; needs founder approval |
| 6 | Cohort expansion 3 → 10 criteria approved | **NO-GO** | proposed in section 5; cohort today: 0 (allowlist empty) |
| 7 | Status page covers trading | **NO-GO** | `/status` checks only the RPC gateway; `/trading-agent/status` is behind `SITE_TRADING_AGENT` (off) |
| 8 | Monitoring backend receiving trading metrics and alerts | **NO-GO** | Stage 29 rules and dashboard exist as files; no backend chosen |
| 9 | Support runbooks published | **NO-GO** | drafts in section 7; no support channel decided |
| 10 | Incident response tested | **NO-GO** | procedure in section 7; never exercised |
| 11 | Ledger: revenue kinds / real-book posting decided | **NO-GO** | Stage 20 stopped |
| 12 | Partner approvals in writing | **NO-GO** | all brokers UNVERIFIED (#486) |
| 13 | Legal / RPrC reviews (terms, risk disclosure, GST invoices, scope B-09) | **NO-GO** | not started |
| 14 | First real trade evidence pack complete, zero variance | **NO-GO** | not executed (#487) |

### CI evidence (this review, 2026-10-06, branch `trading-agent/stage-35-launch-readiness`)

- **Trading integration suites** (local throwaway Postgres; guard-DB recipe): **12 files, 47 tests, all passing.**
- **API baseline** (`scripts/ci-baseline-check.sh`): 977 tests, 850 passing, 5 failing, 122 pending.
  - 2 failures are the known baseline.
  - 3 others: two `identity_rate_limit` tests and one `internal_dodo` test. **Each file passes when run alone** (17/17 and 32/32, twice each), so these are load flakes, not regressions. `internal_dodo` is a newly seen flake.
  - The baseline file also lists 17 known failures that now pass and should be pruned.
- **Not run:** `migrations.integration.test.ts` (needs Docker); the opt-in sandbox and testnet tests (no credentials).

## 4. Flags plan (proposed; humans only)

Every flag defaults OFF. Claude Code changes none of them. Each step needs the founder, after the gates it names.

| Order | Flag | Where | Turned on when |
|---|---|---|---|
| 1 | `SITE_TRADING_AGENT` | web | partnership and legal copy reviewed (B-09); pages still make no availability claim |
| 2 | `CONSOLE_AGENT_IA` | console | the trading API is registered (B-03, B-06, B-10 resolved) |
| 3 | `TRADING_AGENT` | API | Gate 0 met; staging soak passed |
| 4 | `BINANCE` / `UPSTOX_COPILOT` / `ALPACA` | API | per broker: PAPER-VALIDATED and PARTNER-APPROVED |
| 5 | `MCP_TRADING`, `BYOK`, `SUBSCRIPTIONS` | API | each with its own sign-off (Gate 7 for BYOK; live billing approval for SUBSCRIPTIONS) |
| 6 | `LIVE_SMALL` | API, allowlisted accounts only | REAL MONEY GATE 1 signed; unlock PR merged |
| 7 | `REVENUE_ENGINE` | API | Stage 20 decided; REAL REVENUE GATE 1 verified for that path |
| — | `LIVE_TRADING`, `AUTONOMOUS_MODE`, `UPSTOX_AUTOMATED` | code | **stay LOCKED**; unlocking is a separate two-person-reviewed PR, out of scope for this launch |

## 5. Cohort expansion 3 → 10 (proposed)

- **Start at 3** invited, allowlisted accounts (LIVE_SMALL ceilings: ≤ 50 USDT per order, ≤ 200 USDT per day, entries ≤ 30 days).
- **Expand to 10 only when all of these hold over at least 14 consecutive days:**
  - zero reconciliation variance;
  - no order left in UNKNOWN more than 60 s;
  - no unexplained kill-switch engage;
  - no P1 incident;
  - every alert acknowledged within its target.
- **Mechanics:** each new account is added to the allowlist through a reviewed PR, with its own key snapshot and authorisation. The ceilings don't change during expansion.
- **Fall back:** any STOP rule from the first-trade runbook returns the cohort to the last good size, and engages the kill switch for the affected accounts.

## 6. Rollback (procedure; drill NOT performed)

Drill, to be run in **staging** once it exists (B-06), and recorded with times:

1. Engage the global kill switch; confirm new orders are rejected at risk check 1.
2. Turn off `LIVE_SMALL`, then `TRADING_AGENT`. Confirm the routes return the flag-off response.
3. Cancel working orders at each venue (human), and resolve UNKNOWN orders by history lookup only.
4. Revert the unlock PR, so `LIVE_TRADING` is locked again in code.
5. Redeploy the previous release through the normal merge-to-`main` path.
6. Run portfolio and order reconciliation: zero variance.
7. Record the timings and the outcome in the drill evidence. Target: trading halted within 5 minutes of the decision.

Data is never deleted in a rollback. Ledger corrections are reversal entries only.

## 7. Support and incident response (drafts)

- **Support runbooks** (to publish once a support channel is chosen):
  - "my order is stuck": UNKNOWN or SENT, so look it up at the venue, never resend;
  - "my numbers look wrong": run reconciliation, then answer;
  - "pause my account": engage the user-scope kill switch;
  - "revoke my broker key": revoke at the venue, then remove the credential;
  - "why did Satelink do this?": the Stage 19 audit receipt.
- **Severity:**
  - P1: money at risk or a wrong order;
  - P2: trading unavailable;
  - P3: degraded.
- **On P1:**
  1. Engage the kill switch at the narrowest scope that covers the problem.
  2. Freeze the affected flags.
  3. Reconcile.
  4. Notify the affected users.
  5. Write it up within 48 h.

  Alert routing needs the monitoring backend (go/no-go item 8).
- Incidents, decisions and timings go in the evidence folder. No customer data goes into the public repository.

## 8. Founder go/no-go

| Field | Value |
|---|---|
| Decision | **NO-GO** (recommended by this review) |
| Signed by (founder, GitHub login) | — |
| Date | — |
| Next review when | gates defined and met, staging exists, CI stable |
