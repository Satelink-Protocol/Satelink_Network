# Trading Agent subscriptions billing (Stage 27)

A gateway-neutral subscriptions module for the Trading Agent plans. **Razorpay, test mode only.**
- The `SUBSCRIPTIONS` flag stays OFF, and nothing is mounted (same Option A as Stage 24).
- The existing **Dodo / Pricing V2** billing for Trading Intelligence is not touched.

| File | Purpose |
|---|---|
| `gateway.mjs` | `PaymentGateway` contract; registry (`razorpay` implemented, `dodo` = existing Pricing V2 path, untouched) |
| `razorpay.mjs` | `RazorpayGateway`: `rzp_test_` keys only (live refused); plans, subscriptions, plan change, cancel; HMAC webhook verify (raw body, constant time) |
| `plans.mjs` | versioned catalog + entitlements (**draft**: test-mode fixture prices, never usable live) |
| `lifecycle.mjs` | Razorpay state → Satelink state; grace period; dunning reminder schedule |
| `proration.mjs` | preview of Razorpay's daily-rate proration (integer paise, half-even, ≥ 50 subunits) |
| `invoices.mjs` | one invoice per captured payment with GST **metadata** fields (RPrC; no tax computed) |
| `books.mjs` | test mode → `SimSubscriptionBook`; live mode → `RealBookPosting` refuses (Stage 20) |
| `store.mjs` | in-memory + Postgres (migration 030) stores; webhook effects in one transaction |
| `service.mjs` | `BillingService`: start / preview / change / cancel / invoices; idempotent webhooks; dunning |
| `router.mjs` | `/billing/*` (Stage 24 middleware) + `POST /webhooks/razorpay` (raw body); `mountBillingRoutes` |
