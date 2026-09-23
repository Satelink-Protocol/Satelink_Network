# A8 — Scope trims for Pricing V2

Explicit non-goals, recorded so they aren't accidentally built later without a
fresh decision:

1. **No AI-token, compute, or external-provider meters.** Satelink sells none
   of these today. The Usage Unit table's "AI tokens / compute / external
   providers" row is `COST_UNKNOWN` and intentionally has no product behind
   it — do not build a meter for a product that doesn't exist (see
   `02_USAGE_UNIT_MODEL.md`).
2. **"Priority capacity" on Max is not shown.** Not implemented; do not
   reference it in pricing copy, the compare matrix, or plan descriptions
   until it's a real, built feature.
3. **Enterprise stays "Contact us" only.** No price, no self-serve tier, no
   feature matrix row beyond "Coming later — contact sales." This matches
   what web PR #402's pricing page already does (`§4.3` "Enterprise: shown as
   'Coming later — contact sales' card only; no price").
