# Stage 33 — First real trade: runbook + evidence template

**No trade was executed, and none can be yet.** Stage 33 triggered its STOP: REAL MONEY GATE 1 isn't signed and there's no user authorisation. The founder chose **Option 1** (2026-10-06): prepare the runbook and the evidence template, with no live action. Acceptance (evidence pack complete, zero reconciliation variance) stays **open** until the founder executes the trade.

PR: #487 (draft, stacked on #486)

## Inspection (read-only, 2026-10-06)

| Check | Result |
|---|---|
| Gate doc signature | **not signed**: verdict CLOSED; no `approvals.json`; founder and independent-reviewer roles missing |
| LIVE_SMALL allowlist | empty: no invited user |
| Flags | `LIVE_TRADING`, `AUTONOMOUS_MODE` and `UPSTOX_AUTOMATED` locked in code |
| Partner state | Binance UNVERIFIED (Stage 32) |
| Deployment | no trading code on `origin/main`; stack #464–#486 unmerged; API unregistered (Option A) |
| Ledger | Stage 20 stopped: no real-book journal possible |

## What was written

| Doc | Content |
|---|---|
| `docs/trading-agent/evidence/first-real-trade-runbook.md` | roles (Claude Code: checklist, read-only monitoring only if granted, evidence assembly), STOP rules, Phase 0 preconditions, pre-trade checks, the trade, post-trade reconciliation table, kill-switch procedure, after-trade steps |
| `docs/trading-agent/evidence/first-real-trade.md` | the evidence pack template: preconditions, user authorisation, pre-trade checks, order (incl. the `x-<LinkID>` prefix check), fills, reconciliation (zero variance), ledger journal (BLOCKED), audit, STOP log, sign-off; every field PENDING |

## Design notes

- **Kill switch before investigation.** The OMS reconciler re-queues an order the venue never acknowledged after `notFoundGraceMs` = 120 s. The brief's STOP fires at 60 s of UNKNOWN, so the runbook has the founder engage the `broker_account` kill switch first, which stops any resend at risk check 1, then resolve the order by history lookup only.
- **Mode A only.** The first trade runs under a copilot mandate, so the user approves the one order with step-up. Mode B is still blocked by risk check 3, and mode C is locked.
- **Ledger journal marked BLOCKED.** The evidence pack can't be complete until Stage 20 is decided. This is listed as a Phase 0 precondition.
- **Binance only.** It's the only venue with a Gate 6 path (Stage 30).
- **Public repo.** The pack records ids, hashes and amounts only: no keys, no Link ID value, no personal data.

## Tests

Docs only; no code changed. The blocker-register test (stage docs need a `## Blocker impact` section, and public docs must contain no exploit detail) still passes.

## Blocker impact

| Blocker | Touched? | Note |
|---|---|---|
| B-01 … B-11 | referenced | Phase 0 requires every register blocker RESOLVED (Gate 0) |
| B-06 | referenced | staging deploy before production |
| B-08 | referenced | key snapshot bound to the static egress IP |
| B-09 | referenced | Binance PARTNER_APPROVED with written evidence |
| Stage 20 / 28 | blocking | ledger journal (20); Gate 7 security (28) |

No blocker changes status. The Stage 33 row is added to the acceptance log in `docs/trading-agent/BLOCKERS.md`.

## Rollback

Not applicable: docs only. The kill-switch procedure for the real trade is in the runbook.
