# 14 — Analytics

No analytics exists in apps/web today (discovery §5) → add **Vercel Web Analytics**
(privacy-friendly, Vercel-native; founder-approved). §15.

## Events (via `data-cta` attributes + minimal client wrappers)
Page views · CTA clicks (`data-cta`) · docs clicks · pricing views · calculator
use · signup start/complete · API key creation (from console events if exposed) ·
dashboard entry · academy tutorial start/complete · support search + article
"helpful" votes · blog read depth · contact-sales submits · checkout_start /
checkout_redirect / checkout_success.

## Funnels
- Home → Product → Docs → Signup
- Pricing → Checkout → Success

## Rules
- **Never display analytics numbers publicly** (§2, §15).
- No PII in events. Consent-aware where required.
- Analytics numbers in the CMS admin are a read-only embed (§13), not public.
