# First real trade: runbook

> **Status: NOT EXECUTABLE.** REAL MONEY GATE 1 is unsigned (verdict CLOSED), the LIVE_SMALL allowlist is empty, `LIVE_TRADING` is locked in code and no trading code is deployed (verified read-only 2026-10-06). This runbook is prepared in advance. **Every step is performed or approved by the founder. Claude Code never places an order, changes a flag or handles a real key.**

One small real order, for one invited external user, on **Binance Spot** (the only venue with a Gate 6 path), under the LIVE_SMALL caps. Evidence is recorded in [`first-real-trade.md`](first-real-trade.md).

## Roles

| Who | Does | Never |
|---|---|---|
| Founder | every action: unlock, flag, approval, kill switch, sign-off | delegates a live action to an agent or a script |
| Invited user | authorises the mandate and approves the one order (step-up) | shares keys or codes with anyone |
| Independent reviewer | second person on the gate and the unlock PR | approves their own change |
| Claude Code | prepares this checklist; reads logs **only if the founder grants read-only access**; assembles the evidence pack | places orders, changes flags or env vars, sees keys or codes |

## STOP rules (any one, at any step)

1. **Any mismatch:** order, fill, position, fee or reconciliation differs between Satelink and Binance.
2. **UNKNOWN unresolved for more than 60 s:** the order is in `UNKNOWN`, or still `SENT` past the 30 s grace.
3. **User authorisation missing:** no recorded mandate, no step-up approval, or the account isn't on the allowlist.
4. **Anything unexpected:** an error, an alert, or a number you can't explain.

**On STOP:** the founder runs the kill-switch procedure below **first**, then investigates. Never retry or resend by hand.

> **Why the kill switch comes first:** the order reconciler re-queues an order the venue never acknowledged after 120 s (`notFoundGraceMs`, `oms/reconciler.mjs`). The 60 s STOP comes before that, and engaging the account kill switch stops any resend at risk check 1.

## Phase 0: preconditions (all must be true; record each reference)

- [ ] **REAL MONEY GATE 1 signed.** `docs/trading-agent/gates/real-money-gate-1.md` is regenerated on the gate commit with verdict READY FOR FOUNDER DECISION. `evidence/approvals.json` holds two distinct approvers (founder + independent reviewer) on the current evidence hash. Record the file, commit and hash.
- [ ] **Gate 0, 6 and 7 met.** Every register blocker is RESOLVED; there are 5 green nightly runs; the security controls are evidenced.
- [ ] **Stage 20 decided.** The ledger kinds are approved, so the trade's fee and fills can be journaled in the real book. *Without it the evidence pack cannot be complete.*
- [ ] **Binance PARTNER_APPROVED** in `docs/trading-agent/partners/partners.json`, with the Link ID in the secret store (`TRADING_BINANCE_LINK_ID`) and its fingerprint matching.
- [ ] **Unlock PR merged.** It removes `LIVE_TRADING` from `LOCKED_TRADING_FLAGS` and was reviewed by both approvers.
- [ ] **Trading code deployed to staging, then production** (B-06). The API is registered by a founder-approved change (currently Option A: unregistered).
- [ ] **The invited user is on the allowlist** with caps within the ceilings (≤ 50 USDT per order, ≤ 200 USDT per day) and an expiry ≤ 30 days.
- [ ] **The invited user's key snapshot is ≤ 24 h old:** withdrawals and transfers off, IP restriction on, bound to the static egress IP.
- [ ] **Read-only observability access**, if Claude Code is to watch: granted by the founder, scoped read-only, with an expiry. Record what was granted.

## Phase 1: pre-trade checks (founder; Claude Code may read)

1. **Flags, read-only:** `LIVE_SMALL` on for the allowlisted account only; `AUTONOMOUS_MODE` and `UPSTOX_AUTOMATED` still locked. Snapshot the values (names and on/off only).
2. **Kill switches:** none engaged on the account, venue or instrument; the global switch is released.
3. **Risk policy:** the account's caps are no higher than the allowlist entry.
4. **Mandate:** the user's mandate is active, in mode A (each order approved), scoped to the one instrument.
5. **Reconciliation baseline:** a portfolio reconciliation check on the account reports zero variance before the trade. Record the `reconciliation_events` id.
6. **Venue filters:** read the instrument's `exchangeInfo` (minimum notional, lot and tick size). Choose a quantity just above the minimum and inside the per-order cap.

## Phase 2: the trade (user and founder; Claude Code does not act)

1. A **LIMIT** order is proposed for the user, at a price close to the market, for the quantity chosen in Phase 1.
2. The user reviews and **approves it with step-up**. Record the approval id.
3. The risk engine decides. Record the decision id (expect ALLOW, with all checks listed).
4. The OMS dispatches it. Watch the states: `NEW → SENT → ACK → PARTIAL/FILLED`.
5. **Check the prefix:** Binance's `clientOrderId` must start with `x-` + the Link ID, and the rest must equal the OMS client order id.
6. If it isn't filled within the agreed window, the **user** cancels it and the cancel is recorded. That is still a valid first execution if no fill occurred, but the evidence pack must say so.

## Phase 3: post-trade reconciliation (zero variance required)

| Check | Source A (Satelink) | Source B (Binance) | Pass |
|---|---|---|---|
| Order status and quantities | OMS order + `order_events` | order history by `origClientOrderId` | equal |
| Each fill | `fills` rows | `myTrades` for the order id | same trade ids, quantities, prices |
| Fee | fill commission + asset | `myTrades` commission + commissionAsset | equal, same asset |
| Position | portfolio position | account balances after the trade | difference = 0 |
| Portfolio reconciler | `reconciliation_events` row after the trade | — | matched, zero variance |
| Ledger | journal for the trade (Stage 20) | — | balanced, amounts equal the fills and fee |

Any non-zero difference is a **STOP**.

## Kill-switch procedure (founder)

1. **Engage the account:** `broker_account` scope, reason "first real trade STOP: <rule>". This stops every new order on the account at risk check 1.
2. **If more than the account may be affected,** engage at `venue` scope (Binance) or `global`.
3. **Turn the flag off:** unset `TRADING_FLAG_LIVE_SMALL` in the hosting console.
4. **Working orders:** if an order is still working at Binance, the founder or the user cancels it at Binance directly. Record the cancel.
5. **Resolve UNKNOWN by lookup only:** query Binance order history by client order id. Never resend.
6. **Record** the STOP in the evidence pack: time, rule, actions.
7. **Release is a human decision,** narrower than or equal to the engage, by an admin for admin-engaged switches. It happens only after the cause is explained in writing.
8. **Full rollback:** revert the unlock PR so `LIVE_TRADING` is locked again.

## After the trade

- Fill in every field of [`first-real-trade.md`](first-real-trade.md). Claude Code can assemble it from the records the founder exports or grants read access to.
- The founder and the independent reviewer sign off the pack.
- Disable `LIVE_SMALL` again until the next decision.
