/**
 * Satelink-OS border + radius tokens. Mirrored as `--sat-radius-*` /
 * `--sat-border-*` in theme.css.
 */
// Tight radii to match SigNoz (dominant 2px, then 4px) — a key "enterprise, not
// MVP" signal. 6px reserved for the largest surfaces.
export const radius = {
  none: 0,
  sm: 2,
  md: 4,
  lg: 6,
  pill: 999,
} as const;

export const borderWidth = {
  hairline: 1,
  accent: 2, // top-accent on metric cards, left-accent on active nav
} as const;

export type RadiusToken = keyof typeof radius;
