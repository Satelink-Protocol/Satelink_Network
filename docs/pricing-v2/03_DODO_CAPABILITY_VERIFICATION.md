# A4 — Dodo capability verification (researched, not assumed)

Per instruction: "verify, don't assume." This checked Dodo's own documentation
(WebFetch against `docs.dodopayments.com`) rather than guessing. Sources are
cited inline. **This is a documentation-based finding, not a live sandbox
test** — before writing any code against it, smoke-test the exact fields in
Dodo's test-mode dashboard.

## 1. "$5 first cycle, then $19/month" — the real mechanism

**Verified: Dodo supports this natively via a paid trial on the subscription
product — not a discount code, and not a separate intro product swapped after
cycle 1.** Per Dodo's own subscription docs (`docs.dodopayments.com/features/subscription`):

- `trial_period_days` — length of the introductory period.
- `trial_amount` — the reduced amount charged during the trial, in minor
  currency units (e.g. `500` = $5.00).
- `trial_apply_discounts` — boolean; whether checkout discount codes further
  reduce the trial charge (defaults to `false`).
- The base recurring `price` field is the **regular** price ($19.00 →
  `1900`), which takes over automatically "at the first renewal after the
  trial ends" — Dodo's own wording.

**For the exact scenario requested:** `trial_period_days: 30`,
`trial_amount: 500`, `price: 1900`. The customer is charged $5 on signup, then
$19 at the first renewal. **No hand-rolled two-product-and-cron-job workaround
is needed** — the brief's fallback instruction ("if nothing supports it
cleanly, report and stop that part") does not apply here, because something
*does* support it cleanly.

### Caveats found (real, worth planning around)
- **No direct "is this subscription in trial" API field.** Dodo's docs say
  detecting trial status currently requires cross-referencing payment history
  — there's no single boolean to read. Whatever surface shows "Renews at
  $19/month" needs to compute this from payment history, not a status flag.
- **A paid trial always requires a card/payment method up front** — consistent
  with charging $5 immediately, not a deferred-charge free trial.
- **Test-mode support for `trial_amount`/`trial_period_days` was not
  explicitly documented** in what I could fetch. Treat as "presumably
  supported, unconfirmed" — the founder should verify by creating a real test
  product with these fields in Dodo's test-mode dashboard before any build
  work assumes it works.
- Plan changes (`changePlan` API) work independently of trial state per the
  docs — a customer upgrading mid-trial doesn't appear to have special-cased
  restrictions, but this wasn't stress-tested here.

## 2. India RBI e-mandate compliance

**Verified against `docs.dodopayments.com/features/payment-methods/india`**
and the RBI's consolidated E-mandate Framework (effective 2026-04-21, per
independent web search of `amlegals.com`'s compliance summary — a secondary
source, not Dodo's own docs, cited separately below).

### Does the mandate need to cover the $19 renewal from the start?
**No, and this is good news for the $5→$19 design.** Dodo's own documentation
states the mandate amount registered with the customer's bank is
**`max(mandate_floor, billing_amount)`**, with a **default `mandate_floor` of
₹15,000**. Since $5 (~₹415) and even $79 (~₹6,340) are both far below ₹15,000,
the mandate is set at the ₹15,000 floor from the very first ($5) charge —
**the transition to $19/month at renewal does not exceed the existing mandate
and does not require re-authorization.** Dodo's docs are explicit that
re-authorization is only needed when "an upgrade results in a charge exceeding
the existing mandate limit" — which none of Free/Launch/Pro/Max do.

### Pre-debit notification window
The RBI's E-mandate Framework (per the secondary source found — **not
independently confirmed on Dodo's own pages**, which describe the flow
qualitatively without stating an exact hour count) requires a mandatory
pre-debit notification before a recurring debit — commonly cited as a 24-hour
minimum window in which the customer can cancel. Dodo's own docs describe a
"Bank → Customer: Pre-debit notification" step and a customer cancellation
window via their banking app, referencing a "~48 hour + up to 3 hours bank
processing" total settlement timeline, but **I could not find an explicit
statement on Dodo's pages of the exact pre-debit notification lead time.**
**This specific number should be confirmed directly with Dodo (support or
dashboard docs) before launch** — don't take my secondary-source figure as
authoritative for a compliance claim.

### No-extra-authentication transaction limit
The RBI framework's no-extra-authentication limit is commonly cited at
₹15,000 per transaction for general recurring payments (higher, ₹1,00,000, for
specific categories like insurance/SIPs/credit-card bills — not applicable
here). All of Satelink's plan prices (₹415 / ₹1,580 / ₹6,340 for $5/$19/$79 at
a rough ₹83/$1) sit comfortably under this limit.

### Required copy — "$5 for your first month. Renews at $19/month."
Per the brief, this must appear at: pricing, checkout, confirmation, billing,
and the pre-renewal email. **This is a UI/content requirement for the build
phase, not something to implement here** — noted so it's not lost. Given the
"no direct trial-status field" caveat above, the pre-renewal email in
particular will need to be triggered from Dodo's subscription webhook events
(e.g. an upcoming-renewal event) rather than a polled status field — confirm
Dodo's webhook event catalog includes a suitable "renewal upcoming" event
before building that email.

## Sources
- [Dodo Payments — Subscriptions](https://docs.dodopayments.com/features/subscription)
- [Dodo Payments — India Payment Methods](https://docs.dodopayments.com/features/payment-methods/india)
- [Dodo Payments — Discount Codes and Coupon Management](https://dodopayments.com/distribution/discount-codes)
- [Dodo Payments — UPI Autopay blog](https://dodopayments.com/blogs/upi-autopay)
- [UPI Autopay and Recurring Payments: Compliance Checklist Under RBI's E-Mandate Framework 2026 — amlegals.com](https://amlegals.com/upi-autopay-and-recurring-payments-compliance-checklist-under-rbis-e-mandate-framework-2026/) (secondary source, RBI framework summary — not Dodo's own docs)
