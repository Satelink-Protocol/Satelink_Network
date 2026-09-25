# Unified design system — "the jakuraa.com standard"

One modern-minimalist system for **satelink.network**, **console.satelink.network**,
**docs** and **jakuraa.com** (2026-09-25). Structure, spacing, interaction and
typographic hierarchy follow the claude.com / claude.ai pattern; assets, fonts,
logos and copy are our own.

> `@satelink/ui` (`packages/ui`) is the separate admin/operator system scoped to
> `.satelink-os`. It is not part of this system.

## Where it lives

| Layer | File | Owns |
|---|---|---|
| Foundation (brand-agnostic) | `packages/web-ui/src/styles/foundation.css` | spacing scale, type scale, radius, elevation-3, stacking (`--sl-z-*`), motion |
| Satelink brand layer | `packages/web-ui/src/styles/tokens.css` | palette (light + true dark), fonts, `@theme` → `sl-*` Tailwind utilities, legacy aliases |
| Jakuraa brand layer | `apps/corporate/app/globals.css` | ivory/ink/green palette (light + dark), `band` tokens |
| Components | `packages/web-ui/src/components/{ui,site}` | Button, Card, …, `MegaMenuHeader`, `Wordmark`, `SearchPalette`, `DataFooter` |

**Import rule (load-bearing).** Each app imports its brand layer from its
Tailwind entry, *after* `@import "tailwindcss"`:

```css
@import "tailwindcss";
@import "../../../../packages/web-ui/src/styles/tokens.css"; /* pulls foundation.css */
```

Imported anywhere else (e.g. from `layout.tsx`) Tailwind never sees the `@theme`
block and **no `sl-*` utility is generated** — which is exactly what made the
production mega-menu transparent, every border black and every primary button
unfilled (AUDIT_2026-09-25 D1–D3). Guarded by `apps/web/test/tailwind-token-entry.test.ts`.

## Brand layers

**Satelink** — calm, high-contrast, warm-neutral.

| Token | Light (default) | Dark (true dark) |
|---|---|---|
| `--sl-bg` | `#FAF9F5` | `#0F0F0E` |
| `--sl-surface` | `#FFFFFF` | `#1A1A18` |
| `--sl-border` / `-strong` | `#E7E3DA` / `#D2CDC1` | `#2C2B27` / `#3D3B36` |
| `--sl-text` / `-muted` / `-subtle` | `#1A1915` / `#55524A` / `#6B675C` | `#EEECE6` / `#AAA69C` / `#8E8A80` |
| `--sl-accent` (the one primary) | `#0B7A6B` | `#5CD6C3` |

Product colours carry meaning and are used sparingly — **icons, dots, chart
series and tints only, never body or link text** (they fail AA as small text):
teal `--sl-accent` platform · indigo `--sl-machine` machine/x402 · amber
`--sl-market` market data · sky `--sl-settle` settlement. Every text pair is
AA-checked by `apps/web/test/token-contrast.test.ts`.

**Jakuraa** — ivory `#faf8f3`, ink `#15130f`, deep green `#1f4d3a`; dark mode
inverts roles (`#12110e` / `#efece4`, green lifted to `#86c4a3`). The Satelink
band (`bg-band`) stays deep green in both themes.

## Type
- **Display:** Source Serif 4 (same family as jakuraa.com), weight 400, tracking −0.015em, line-height ~1.08. H1, section H2s, feature-card titles, the wordmark.
- **Body:** Inter. **Numbers & code:** JetBrains Mono, tabular numerals.
- Both Inter and Source Serif 4 load as **variable fonts** (one file each; no `weight` list) — part of the Lighthouse ≥ 90 budget.
- Eyebrows are sentence-case muted text, not uppercase accent labels.

## Foundation scales
Spacing `--sl-space-1…10` (4 → 128 px) · section rhythm `--sl-section-y`
(64–128 px) · radius 6 / 10 / 16 / pill · elevation `--sl-shadow-1/2/3`
(3 = overlays) · motion `--sl-dur-1/2/3` 120/220/360 ms — **motion only for
reveal and the machine-pays demo** · stacking `--sl-z-backdrop` 40 <
`--sl-z-header` 50 (the mega-menu sheet lives inside the header) <
`--sl-z-dialog` 80 < `--sl-z-toast` 90.

## Header (claude.com pattern)
`Wordmark · Products · Solutions · Pricing · Developers · Resources` —
right: `[search][theme]` icon cluster · **Log in** · **Try Satelink** (the single
primary). Contact sales lives in Solutions and the footer. Nav data:
`packages/content/src/navigation.ts` (CMS-overridable).

Mega-menu: a **solid** full-width sheet (`bg-sl-surface`, `shadow-3`), 2–3 link
columns + one feature card, over a dimmed + blurred backdrop so the page is never
legible through or beside it. Keyboard: Enter/Space/↓ open (↓ focuses the first
link), Esc closes and returns focus, focus leaving closes. Mobile: full-screen
drawer, focus trap, scroll lock, 56 px rows, CTAs pinned to the bottom.

## Sign-in (claude.ai/login pattern)
`console.satelink.network/sign-in` is the one customer sign-in: wordmark, one
serif headline, Continue with Google, OR, email → magic link, legal line.
`?mode=signup` changes the words only. `satelink.network/login` and `/signup`
307 to it; staff stay on `/ops/login`.

## Gates
| Gate | Where |
|---|---|
| No overlap / clipping at 360–1440 × light/dark; menu opaque + covering hero (hit-test); drawer full-screen + focus trap; no horizontal scroll; axe | `apps/web/e2e/header-overlap.spec.ts` |
| Sign-in pattern, theme-follow, axe at 5 breakpoints × 2 themes | `apps/console/e2e/sign-in.spec.ts` |
| Tokens compiled by Tailwind | `apps/web/test/tailwind-token-entry.test.ts` |
| AA contrast of every text pair, both themes | `apps/web/test/token-contrast.test.ts` |
| Lighthouse mobile Performance ≥ 90 on `/` | `npx lighthouse <url> --only-categories=performance` (2026-09-25 local prod build: 92 / 96 / 95) |
| Screenshot audit (all three properties, 60 captures + axe) | `scripts/audit/prod-screenshot-audit.mjs` (`SAT_BASE` / `CONSOLE_BASE` / `JAK_BASE` to target previews) |
