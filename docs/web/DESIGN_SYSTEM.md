# Satelink Signal — Design System

The single design language for the public marketing site (`apps/web`, the `(marketing)` + `(checkout)` route groups and the shared chrome). Source of truth: **`apps/web/src/styles/tokens.css`**. Components: **`apps/web/src/components/ui/`**. Live gallery: **`/styleguide`** (noindex), both themes side by side.

> Not to be confused with `@satelink/ui` (`packages/ui`), the separate shadcn/Radix system scoped to `.satelink-os` that dresses the admin/operator dashboards. Satelink Signal does not depend on it.

## Principles (§5.2)
Serious financial-data product, not crypto hype. Dense but calm — data is the hero. **One** accent. Monospace **only** for numbers, code, and identifiers. **No emoji icons** (lucide-react via `<Icon>`). No gradients-on-everything. Dark-first with a complete light theme.

## Tokens
All tokens are CSS custom properties prefixed `--sl-*`, defined for dark (`:root, [data-theme="dark"]`), light (`[data-theme="light"]`), and the OS-preference fallback (`@media (prefers-color-scheme: light)`). Legacy names (`--bg-*`, `--text-*`, `--accent`, …) and the bare shadcn names (`--background`, `--card`, `--border`, …) are **aliased** onto `--sl-*` in the same file so pre-migration markup keeps rendering with no regression.

| Group | Tokens |
| --- | --- |
| Surfaces | `--sl-bg`, `--sl-bg-raised`, `--sl-surface`, `--sl-surface-hover`, `--sl-border`, `--sl-border-strong` |
| Text | `--sl-text`, `--sl-text-muted`, `--sl-text-subtle` |
| Brand | `--sl-accent`, `--sl-accent-strong`, `--sl-accent-ink`, `--sl-accent-soft` |
| Data | `--sl-up`, `--sl-down`, `--sl-warn`, `--sl-info`, `--sl-model` (modelled/proxy only) |
| Elevation | `--sl-shadow-1`, `--sl-shadow-2`, `--sl-ring` |
| Shape | `--sl-radius-sm` 6px, `--sl-radius` 10px, `--sl-radius-lg` 16px, `--sl-radius-pill` |
| Type | `--sl-font-sans` (Inter), `--sl-font-mono` (JetBrains Mono) — both self-hosted via `next/font` |
| Motion | `--sl-ease`, `--sl-dur-1` 120ms, `--sl-dur-2` 220ms |

### Tailwind v4 utilities
Exposed via `@theme inline` under an `sl-` namespace so nothing clobbers existing `--color-*`:
`bg-sl-surface`, `text-sl-text`, `text-sl-text-muted`, `border-sl-border`, `text-sl-accent`, `bg-sl-accent-soft`, `font-sl-mono`, `rounded-[var(--sl-radius)]`, etc.

## Type scale
rem: 0.75 / 0.875 / 1 / 1.125 / 1.375 / 1.75 / 2.25 / 3 / 3.75. Body line-height 1.5, display 1.15, letter-spacing −0.02em at ≥1.75rem. `font-variant-numeric: tabular-nums` on all numeric data (`.sl-tnum`, `tabular-nums`).

## Layout
Container max 1200px; section padding `py-20 md:py-28`; 16px side gutter on mobile, no horizontal page scroll.

## Components (§5.5) — `src/components/ui/`
`Button` (primary/secondary/ghost/link · sm/md/lg · loading · asChild) · `Badge` (live/planned/model/neutral/up/down) · `Card` (+ `CardTitle`, `CardDescription`) · `SectionHeader` (eyebrow/title/lede) · `StatTile` (loading / error / ok — **never "—"**) · `MetricCard` · `PriceCard` (featured, note) · `CodeBlock` (copy + curl/TS/Python tabs) · `TerminalWindow` (traffic-light dots — the only allowlisted hardcoded hex) · `ComparisonTable` (booleans → check/dash, factual cells only) · `Disclosure` (info style, never warning-red) · `Stepper` (checkout) · `Field`/`Input`/`Textarea`/`Select`/`Checkbox` · `Icon` (lucide wrapper) · `ThemeToggle` · `Toaster`/`toast` (sonner). Shared chrome `SiteHeader`/`SiteFooter` are in `src/components/site/`.

Every interactive primitive has a `focus-visible` ring (`--sl-ring` / `ring-sl-accent`), works in dark + light, and is keyboard-complete.

## Do / Don't
- **Do** use `font-sl-mono` for prices, counts, latencies, addresses, code.
- **Do** show `StatTile` error state when a live fetch fails.
- **Don't** hardcode hex outside the §5.4 allowlist (`TerminalWindow`, chart palette, OG image, icon).
- **Don't** use emoji as icons, or red for compliance callouts (that's `Disclosure`, info style).
- **Don't** reintroduce the shadcn HSL set or the oklch slate palette at `:root`.
