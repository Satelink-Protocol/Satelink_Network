# Stage 45 — Mode B for agents / machines (Phase 6 item 12)

**A reviewed change to the Stage 15 risk engine** (`risk-checks/1.0 → 1.1`), behind a new flag `MANDATE_MODE_B` (default OFF, not locked).

## Inspection

| Existing | Where | Finding |
|---|---|---|
| check 3 `trading_flags` | `risk/checks.mjs` | an order without `approvedBy` required `AUTONOMOUS_MODE` (LOCKED) → no agent order could ever proceed |
| check 7 `mandate` | same | copilot mandates require the owner's approval per order |
| Mode B mandate terms | `authorization/terms.mjs` (Stage 16) | Mode B binds a deterministic strategy version (021 mode `automated`) |
| agent key scope / mandate binding | `access/` (item 11) | `EXECUTE_UNDER_MANDATE` keys are bound to one mandate |
| scorecard decisions | `decision/` (item 6) | GO / WAIT / REJECT with `expires_at` and subject |
| OMS acceptance | `oms/acceptance.mjs` | no origin logic of its own — the risk engine is the single enforcement point |

## The rule

An agent / machine proposal (`origin: 'agent_proposal'`, no `approvedBy`) may proceed to the OMS without a per-order human click only if ALL hold — otherwise REJECT:

1. `MANDATE_MODE_B` is on (check 3; otherwise the old rule: `AUTONOMOUS_MODE`, LOCKED). Upstox still needs `UPSTOX_AUTOMATED` (LOCKED).
2. A human step-up-signed (TOTP / passkey) Mode B mandate (021 `automated`, terms mode B) covers it: same principal and account, active, in window, the order's strategy version = the mandate's binding, the instrument in the mandate (check 7).
3. The proposer's key is `EXECUTE_UNDER_MANDATE`, bound to this mandate, owned by this principal.
4. A persisted scorecard **GO** for the same principal, instrument and side, not expired.
5. All 20 risk checks pass, and the order is within the **LIVE_SMALL caps** (50 per order, 200 per day, policy currency).
6. **Live** mode additionally needs `LIVE_TRADING`, which is LOCKED → today Mode B is **paper only**.

Check 7 also refuses any unapproved non-Mode-B order on its own (defence in depth behind check 3). The check count stays 20.

## Test evidence (2026-10-08)

| Suite | Result |
|---|---|
| `apps/api/test/trading_mode_b.test.js` | **33 passing**: flag default OFF / not locked; checks 20, version 1.1; APPROVE with every condition; **26 refusal paths each tested** (flag off, live with LIVE_TRADING set, other origin, copilot, Mode A, Mode C, not step-up signed, expired, revoked, other strategy version, instrument outside mandate, no / PROPOSE-scope / other-mandate / other-owner / mismatched proposer, no / WAIT / REJECT / expired / other-side / other-instrument / other-id scorecard, per-order cap, daily cap, global kill switch); defence in depth in check 7; cap boundary; human-approved orders unchanged; RiskEngine records approvals and refusals; expiry precedence (mandate window before scorecard) |
| Stage 15 / flags / scorecard / audit / register / real-money gate suites | **92 passing** (version pins updated to 1.1; `MANDATE_MODE_B` added to the flag list) |
| `database/__tests__/trading-mode-b.integration.test.ts` (local Postgres) | **2 passing**: Mode B APPROVE and REJECT (`MODE_B_SCORECARD`) recorded in `audit_events` with `risk-checks/1.1`, append-only; flag off → FLAG_DISABLED recorded |
| All trading integration suites | **19 files, 70 passing** |
| Mutation checks (11) | all caught: Mode B flag not required, any mandate mode, strategy binding ignored, instrument coverage ignored, PROPOSE-scope proposer, WAIT / REJECT as GO, expired GO, per-order cap off, daily cap off, unapproved non-Mode-B orders passing check 7 (survived at first → direct check-7 test added), side mismatch |

## Blocker impact

| Blocker | Touched? | Why the stage stays inside the accepted isolation |
|---|---|---|
| B-08 / B-09 (live execution, scope) | yes, **not resolved** | Mode B is paper-only while `LIVE_TRADING` is LOCKED; unlocking is REAL MONEY GATE 1 |
| B-03 / B-06 / B-10 | no | nothing mounted; no migration |
| Real-money rule | respected | `LIVE_TRADING`, `AUTONOMOUS_MODE`, `UPSTOX_AUTOMATED` unchanged and locked; `MANDATE_MODE_B` default OFF |
