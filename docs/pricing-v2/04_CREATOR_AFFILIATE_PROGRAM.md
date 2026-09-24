# A5 — Creator / affiliate programme — design spec (not built)

**Scope for this phase: attribution + accrual only. No automated payouts. No
code.** This specifies the model precisely enough to build later.

## Commission rule: cleared payments only
A creator earns commission **only on payments that have actually cleared** —
excluding:
- **Refunded payments** — commission reversed if already accrued.
- **Disputed payments** — commission withheld (never accrued) while a dispute
  is open; reversed if the dispute is lost.
- **Payments still inside the refund window** — commission accrual is **held
  for ≥ 30 days** from payment date before being marked payable, so a
  same-window refund never has to be clawed back after the fact.

### Accrual state machine (design)
```
payment.succeeded → PENDING (commission calculated, not yet payable)
  │
  ├─ 30 days pass, no refund/dispute → ACCRUED (payable)
  ├─ refund.succeeded before 30 days → REVERSED (never paid)
  ├─ dispute.opened before 30 days   → HELD (frozen, same as PENDING but flagged)
  │     ├─ dispute resolved in merchant's favor → resumes PENDING → ACCRUED path
  │     └─ dispute lost                          → REVERSED
```
This mirrors the existing Dodo refund/dispute reversal pattern already built
for the platform's own revenue ledger (`internal_dodo.js`'s
`dodo_refund_dispute_log` + freeze/clawback logic) — the creator-commission
ledger should be a **separate table**, following the same *shape* of
idempotent, event-driven reversal, not sharing rows with the platform's own
revenue ledger.

## What ships in a later build phase (not now)
- A `creator_commissions` table: one row per attributed payment, with
  `status` (pending/held/accrued/reversed), the 30-day accrual timestamp, and
  a link to the originating `payment_sources`/`revenue_events_v2` row (never a
  duplicate of that row — attribution metadata only).
- Attribution capture at checkout (referral code / link parameter → creator
  id), stored alongside the existing checkout flow — additive, no change to
  existing checkout money-path code.
- A read-only creator dashboard view of pending/accrued commission. **No
  automated payout mechanism in this phase** — payouts are a manual, later
  decision once accrual is proven correct over a real cohort.

## Disclosure requirement (Indian advertising norms)
Every creator landing page must carry a **visible "Paid partnership / affiliate
link" disclosure** that the creator is required to use — not optional, not
buried in a footer. This should be:
- A structured field on the creator's landing-page content model (not free
  text the creator can omit), rendered prominently near the top of the page,
  consistent with ASCI (Advertising Standards Council of India) influencer
  guidelines on material-connection disclosure.
- Enforced at the CMS/content level: a creator page without this field set
  should fail validation/publish, not just be "recommended."

## Truth-lint extension
**No creator copy may promise trading profits.** Creator landing pages and any
creator-authored content go through the **same banned-phrase truth-lint**
already enforced on Satelink's own marketing copy
(`apps/web/test/truth-lint.test.ts` — bans "signals to profit," "beat the
market," "win rate," "guaranteed returns/profits/...," buy/sell
recommendations, "get rich," and the trading term "alpha"). When creator pages
become a real content type, extend the truth-lint's scanned-file glob to
include them — do not create a second, separate lint with different (weaker)
rules for creator content.

## Explicitly not decided here
- Commission rate/structure (flat vs. tiered, per-plan vs. per-payment) — a
  business decision, not an engineering one; not assumed in this spec.
- Payout mechanism and cadence — deferred to a later phase per instruction.
