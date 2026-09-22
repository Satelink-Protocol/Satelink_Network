# Checkout — flow, states, env, Dodo touchpoints

Production-grade, styled checkout built **on the existing Dodo integration** (§7). No new Dodo product, no webhook change, no billing-semantics change. The `#398` claim-token flow is preserved.

## Flow diagram
```
/pricing  ──(Get started / Starter Pack)──►  /checkout?plan=starter        [(checkout) group, noindex]
                                             │
                            unknown plan ────┴──► 308 → /pricing
                                             │
   Step 1 Account  ─ email (validated) ─────►
   Step 2 Review   ─ summary + disclosures + consent (required) ─►
   Step 3 Pay      ─ POST /api/dodo-checkout {email, productId} ─► { checkoutUrl }
                                             │
                              window.location = checkoutUrl
                                             ▼
                                   Dodo hosted checkout (card / UPI)
                          ┌──────────────────┴───────────────────┐
                     paid │                                        │ cancelled
                          ▼                                        ▼
   return_url = /intelligence/success?claim=<token>        /checkout/cancel
   (canonical #398 page: exchanges claim → key,            "You haven't been charged" + retry
    polls balance, never shows credits pre-confirm)
                          ▲
   /checkout/success ─────┘  (styled pass-through: if ?claim present, 307 → /intelligence/success?claim=…
                              preserving the token exactly; else a styled "pending" state)
```

## Routes
| Route | Rendering | Purpose |
| --- | --- | --- |
| `/checkout?plan=starter` | Server resolves plan → `CheckoutForm` (client) | Pre-checkout: stepper, email, order summary, disclosures, consent, pay |
| `/checkout/success` | Server | Pass-through; forwards `?claim` to `/intelligence/success`; else pending state |
| `/checkout/cancel` | Server (static) | Abandoned/cancelled payment |
| `/intelligence/success` | Client (unchanged, #398) | Canonical post-payment: claim→key, balance poll |

All `(checkout)` routes are `robots: noindex`.

## Dodo touchpoints (unchanged, reused)
- `POST /api/dodo-checkout` → apps/api `/internal/dodo/resolve-account` (email→api_key), `/internal/dodo/create-claim` (one-time token), then `createCheckoutSession({ product_cart:[{product_id, quantity:1}], customer:{email}, metadata:{satelink_account_id}, return_url:'…/intelligence/success?claim=<token>' })`.
- `POST /api/dodo-claim`, `POST /api/dodo-balance`, `POST /api/dodo-webhook` — untouched.
- Plan→product mapping: `findPackByPlan("starter")` picks the pack from `NEXT_PUBLIC_DODO_CREDIT_PACKS` whose label contains "starter" (else $9.99, else first).

## States
- **Account**: email required + regex-validated; Continue disabled until valid.
- **Review**: consent checkbox required; Pay disabled until checked. Disclosures always visible (not collapsed): SaaS analytics / not investment advice / no custody; shared-balance; refund + link.
- **Pay**: loading state, double-submit guarded; error is inline + retryable ("We couldn't start the secure payment…"). Never grants/shows credits client-side.
- **Unconfigured** (`NEXT_PUBLIC_DODO_CREDIT_PACKS` unset): pay disabled, "Checkout is temporarily unavailable — contact us" (no fabricated price beyond the $9.99 label default).

## Env vars (documented in `.env.example`)
| Var | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_DODO_CREDIT_PACKS` | web (public) | `productId:usd:Label` list; must match apps/api `DODO_CREDIT_PACK_USD_VALUES` |
| `DODO_PAYMENTS_API_KEY` | web (server) | Dodo SDK bearer token |
| `DODO_PAYMENTS_ENVIRONMENT` | web (server) | `test_mode` \| `live_mode` (required in prod) |
| `DODO_INTERNAL_SECRET` | web (server) | shared secret for apps/api `/internal/dodo/*` |
| `INTERNAL_API_URL` / `NEXT_PUBLIC_API_BASE` | web | apps/api base |
| `NEXT_PUBLIC_SITE_URL` | web | absolute base for `return_url` |

## Failure modes
- resolve-account 502 → `account_resolution_failed`; claim 502 → `claim_token_failed`; Dodo unconfigured → `dodo_not_configured` (503). All surface as the same retryable inline error to the buyer.
- Dodo webhook is asynchronous; the success page polls balance and shows pending/confirmed/timed-out — it never assumes the credit landed.

## CSP
A checkout-scoped `Content-Security-Policy` (in `next.config.ts`) allows the Dodo checkout + API origins (`checkout.dodopayments.com`, `test.checkout.dodopayments.com`, `api.dodopayments.com`, `test.dodopayments.com`) for `form-action`/`frame-src`/`connect-src`. A site-wide strict CSP is a separate follow-up (kept permissive here to avoid breaking Next's inline bootstrap + the pre-paint theme script).
