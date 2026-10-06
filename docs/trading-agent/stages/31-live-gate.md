# Stage 31 — REAL MONEY GATE 1 checklist tooling

**Human approval is required. This stage enables nothing.** Live trading stays locked in code (`LIVE_TRADING`, `AUTONOMOUS_MODE` and `UPSTOX_AUTOMATED` are in `LOCKED_TRADING_FLAGS`). No flag was set anywhere, no exchange was called and no key was used. **Every live action stops for a founder decision.**

PR: #TBD (draft, stacked on #484)

## What was built

| Piece | Path |
|---|---|
| Gate script (read-only evidence collector + doc generator) | `scripts/trading/real-money-gate.mjs` |
| Generated checklist | `docs/trading-agent/gates/real-money-gate-1.md` |
| LIVE_SMALL allowlist (empty) | `docs/trading-agent/gates/live-small-allowlist.json` |
| Evidence formats for humans | `docs/trading-agent/gates/evidence/README.md` |
| Tests | `apps/api/test/trading_real_money_gate.test.js` (18) |

Run it with `node scripts/trading/real-money-gate.mjs` (add `--check` to evaluate without writing). The exit code is 1 while the gate is closed.

## Checklist items

| ID | Item | Today |
|---|---|---|
| G1-01 | Gate 0: every register blocker RESOLVED | NOT MET (B-01 to B-11 open or partial) |
| G1-02 | Gate 6: 5 consecutive green nightly runs with the testnet exercised, with run links | MISSING (Stage 30 job needs `main` + founder secrets) |
| G1-03 | Gate 7: KMS envelope encryption, DB role separation, static egress, CI secret + licence scan, daily key re-check, admin step-up, prod secrets rotated | MISSING (Stage 28 paused) |
| G1-04 | Key-permission snapshot (`apiRestrictions`): fund-moving permissions off, IP restriction on, trade + read on, ≤ 24 h old, fingerprint only | MISSING |
| G1-05 | Every key bound to the static egress IP | MISSING (B-08) |
| G1-06 | Trading unit, integration and baseline suites green on the gate commit (≤ 7 days) | MISSING |
| G1-07 | LIVE_SMALL allowlist within the ceilings | MISSING (empty) |
| G1-08 | Live flags still locked in code; LIVE_SMALL defined | OK |
| G1-09 | Legal / scope sign-off (B-09) and the RPrC reviews (GST invoices, terms, risk disclosure) | MISSING |

Every item's status is **PENDING-HUMAN**. That status only changes when every item has OK evidence **and** two different people approved that exact evidence hash. Even then the verdict is "READY FOR FOUNDER DECISION": the tool never unlocks or enables anything.

## Design decisions

- **Read-only by construction.** The script reads committed files only: no `process.env`, network, subprocess or database, and it writes exactly one file (the doc). A test enforces this against the source.
- **Restriction rule shared, not copied.** G1-04 imports `REQUIRED_FALSE` and `REQUIRED_TRUE` from the Stage 21 Binance `key_validation.mjs`, so the gate and the adapter can't drift.
- **Snapshots carry no secrets.** A key snapshot has a 16-hex fingerprint, never the key; a snapshot containing `apiKey` or `secret` fails the item.
- **Approvals bind to evidence.** The evidence hash covers each item's id, result and detail. Any evidence change voids earlier approvals.
- **Two-person rule.** Approval needs two distinct GitHub logins (case-insensitive), with roles `founder` and `independent_reviewer`. Each approval is added in a PR that the other person reviews.
- **The unlock is a separate change.** Removing `LIVE_TRADING` from the locked set is its own PR, reviewed by both people. The flag is then set in staging first (B-06), then production, by the founder, never by an agent, a script or CI. The procedure is in the generated doc.
- **LIVE_SMALL ceilings are proposals.** The ceilings (≤ 3 accounts, ≤ 50 USDT per order, ≤ 200 USDT per day, entries valid ≤ 30 days) need a founder decision. They sit far below `HARD_CAPS`, and the per-account risk caps still apply.
- **State separation per broker.** This comes from the public status config (`apps/web/src/lib/trading-agent/status.ts`), so the website and the gate can't disagree. All three brokers: IMPLEMENTED/TESTED; test environment run pending; live LOCKED; real money NO.

## Test evidence (2026-10-06)

- `trading_real_money_gate.test.js`: 18 passing. Coverage:
  - on this repo, the gate is CLOSED with all items PENDING-HUMAN, and the committed doc equals the generated one;
  - the CLI exits 1;
  - a fully evidenced fixture stays closed until two-person approval;
  - removing each of the 9 items in turn closes the gate, even with approvals on the old or the new hash;
  - the two-person rule, hash voiding, key snapshot and allowlist refusals;
  - the read-only source checks.
- Mutation checks: 11 of 11 killed (one approver, missing role, approvals overriding missing evidence (status and verdict), stale snapshot, key material, hash without detail, PARTIAL counting as resolved, cap ceiling, CLI exit code, IP binding).
- `trading_blocker_register.test.js` still passes (7).

## Blocker impact

| Blocker | Touched? | Note |
|---|---|---|
| B-01 to B-11 | read only | the gate reports them; it resolves none |
| B-06 | referenced | the enable procedure requires staging first |
| B-08 | referenced | G1-05 needs a static egress IP |
| B-09 | referenced | G1-09 needs legal / scope sign-off |
| B-10 | referenced | the unlock PR needs two required reviews (branch protection) |
| Stage 20 / 28 | still stopped / paused | Gate 7 cannot pass while Stage 28 is paused |

No blocker changes status. The Stage 31 row is added to the acceptance log in `docs/trading-agent/BLOCKERS.md`.

## STOP

This stage stops here, as briefed. **No live action has been taken, and none will be without the founder.** The next steps belong to humans: collecting evidence, two-person approval, and the separate unlock PR.

## Rollback

Not applicable: the tooling is additive and enables nothing. Delete the script and `docs/trading-agent/gates/` to remove it.
