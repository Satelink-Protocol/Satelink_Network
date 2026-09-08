# Refund Runbook — Task Commerce ("500 Verified Local Business Leads")

Refunds are issued **manually, through Dodo Payments' own dashboard**. There is
no refund API integration in this codebase, and none should be built — this
is a deliberate scope decision. `mark_refunded.mjs` only updates our own
database record *after* a refund has already been issued in Dodo; it never
moves money.

## When to refund

| Situation | Action |
|---|---|
| Apify run failed or returned zero results (order auto-marked `failed`) | **Full refund.** Customer paid ₹499 for nothing delivered. |
| Apify returned fewer than 500 results and the shortfall was >10% (operator got a "suggested partial refund" alert with an amount) | **Partial refund**, at your discretion, around the suggested amount. Not required if the shortfall was minor and the customer didn't complain — the delivery email already discloses the actual count honestly. |
| Brevo email delivery kept failing after retries (order stuck `paid`, operator alerted) | **No refund yet.** This means fulfillment likely still needs to happen (or already happened and just needs to be re-sent) — first retry delivery manually, then only refund if delivery is genuinely not possible. |
| Customer requests a refund directly (buyer's remorse, wrong city/category, etc.) | Founder's discretion, case by case. |

## How to issue the refund

1. Log into the Dodo Payments dashboard.
2. Find the payment by `dodo_payment_id` (stored on the `task_orders` row —
   look it up with `psql` or via `mark_refunded.mjs --list`) or by the
   customer's email.
3. Issue the refund (full or partial) through Dodo's UI.
4. Once Dodo confirms the refund is issued, mark our own record:

   ```
   node scripts/dodo-tasks/mark_refunded.mjs <order_ref>
   ```

   This sets `status = 'refunded'` and `refunded_at = now()` on the
   `task_orders` row. It refuses to run on an order that isn't currently
   `paid`, `fulfilled`, or `failed` (e.g. it won't silently re-mark an
   already-refunded order).

5. Optionally let the customer know the refund has been issued (Dodo may
   already send its own confirmation email — check before sending a
   duplicate).

## Notes

- `mark_refunded.mjs --list` shows every order currently in a refundable
  status (`paid`, `fulfilled`, `failed`) as a quick reference — it does not
  imply all of them need a refund, just that they're not already refunded.
- There's no partial-refund *amount* tracking in the database — `refunded_at`
  only records that a refund happened, not how much. If you need the exact
  amount refunded, that lives in Dodo's dashboard/records, not here.
