# First real trade: evidence pack

> **No trade has been executed.** This is the template, prepared 2026-10-06. Every field is **PENDING**. Procedure: [`first-real-trade-runbook.md`](first-real-trade-runbook.md).
>
> Public repository: record ids, hashes and amounts only. No API keys, no Link ID value, no personal data. Refer to the user by the principal id.

**Status: PENDING (not executed)**

## 1. Preconditions

| Item | Reference | Status |
|---|---|---|
| REAL MONEY GATE 1 signed: gate doc commit + evidence hash | — | PENDING |
| Approvals: `approvals.json` PR, two distinct approvers | — | PENDING |
| Stage 20 ledger decision (journal possible) | — | PENDING (Stage 20 STOPPED) |
| Binance PARTNER_APPROVED (tracker commit) + Link ID fingerprint match | — | PENDING (UNVERIFIED) |
| Unlock PR (`LIVE_TRADING` removed from locked set), two reviews | — | PENDING |
| Staging deploy commit, then production deploy commit | — | PENDING |
| Allowlist entry: principal id, broker account id, caps, expiry | — | PENDING (allowlist empty) |
| Key snapshot ≤ 24 h: fingerprint, captured at | — | PENDING |
| Read-only observability access granted to Claude Code (scope, expiry) | — | PENDING (none granted) |

## 2. User authorisation

| Item | Reference | Status |
|---|---|---|
| Invited user (principal id) | — | PENDING |
| Written consent / terms acceptance reference | — | PENDING |
| Mandate id, mode A, instrument scope | — | PENDING |
| Step-up approval id for this order | — | PENDING |

## 3. Pre-trade checks

| Check | Value | Status |
|---|---|---|
| Flags (names and on/off only) | — | PENDING |
| Kill switches engaged | — | PENDING |
| Risk caps for the account | — | PENDING |
| Pre-trade reconciliation id (zero variance) | — | PENDING |
| Venue filters (min notional, lot, tick) | — | PENDING |

## 4. Order

| Field | Value | Status |
|---|---|---|
| Internal order id | — | PENDING |
| OMS client order id | — | PENDING |
| Binance `clientOrderId` | — | PENDING |
| Prefix check: starts with `x-` + Link ID (fingerprint matches); remainder = OMS id | — | PENDING |
| Instrument, side, type, time in force | — | PENDING |
| Quantity, limit price, notional (≤ per-order cap) | — | PENDING |
| Risk decision id (ALLOW) | — | PENDING |
| Trace id | — | PENDING |
| Binance order id | — | PENDING |
| State timeline (NEW → SENT → ACK → … with times) | — | PENDING |
| Longest time in SENT / UNKNOWN (must be ≤ 60 s) | — | PENDING |

## 5. Fills

| Binance trade id | Quantity | Price | Commission | Commission asset | Matches `fills` row |
|---|---|---|---|---|---|
| — | — | — | — | — | PENDING |

## 6. Reconciliation (zero variance required)

| Check | Satelink | Binance | Variance | Status |
|---|---|---|---|---|
| Order status / filled quantity | — | — | — | PENDING |
| Fills (ids, quantities, prices) | — | — | — | PENDING |
| Fees | — | — | — | PENDING |
| Position / balances | — | — | — | PENDING |
| Portfolio reconciliation event id | — | — | — | PENDING |

## 7. Ledger journal

| Journal / ledger txn id | Entries | Balanced | Equals fills + fee | Status |
|---|---|---|---|---|
| — | — | — | — | **BLOCKED** (Stage 20: real-book posting not approved) |

## 8. Audit

| Item | Reference | Status |
|---|---|---|
| Audit receipt ("Why did Satelink do this?") | — | PENDING |
| `audit_events` ids (proposal, approval, risk decision, order) | — | PENDING |

## 9. STOP log

| Time | Rule | Action taken | Resolved by |
|---|---|---|---|
| — | — | — | — |

## 10. Sign-off

| Role | GitHub login | Date | Status |
|---|---|---|---|
| Founder | — | — | PENDING |
| Independent reviewer | — | — | PENDING |

Acceptance needs every field filled with a reference, reconciliation variance exactly zero, the ledger journal present and both sign-offs.
