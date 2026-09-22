# 15 — Design System & Performance Budget

Keep "Satelink Signal" (`@satelink/web-ui`), raise editorial restraint. §16.

## Design direction
- Larger display type scale (up to 4.5rem); generous whitespace (`section
  py-24 md:py-32`); max text measure 68ch.
- Strong CTA hierarchy — one primary per viewport.
- Mega-menu panels: grouped columns + feature card.
- High-quality SVG diagrams: lifecycle, payment flow, settlement.
- **No emoji icons; no imitation of reference illustrations or typography.**
- jakuraa.com: same tokens, light-first editorial theme, distinct wordmark.

## Performance budget (mobile Lighthouse, CI-blocking)
| Metric | Budget |
| --- | --- |
| Performance | ≥ 90 |
| Accessibility | ≥ 95 |
| Best practices | ≥ 95 |
| SEO | 100 |
| LCP | < 2.5s |
| CLS | < 0.05 |
| Home JS | < 170KB gz |

## Rendering discipline
RSC by default · `next/image` · ISR · lazy-load below the fold · **no client-side
data fetching for content** (SSR/ISR only; Lifecycle stepper SSR'd).

## Tokens
`--sl-*` in `@satelink/web-ui/tokens.css`; dark/light via `data-theme`. No hardcoded
hex in `.tsx` (hex-gate). All state colors from tokens.
