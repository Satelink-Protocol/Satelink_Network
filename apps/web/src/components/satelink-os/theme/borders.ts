/**
 * Satelink-OS border + radius tokens. Mirrored as `--sat-radius-*` /
 * `--sat-border-*` in theme.css.
 */
export const radius = {
  none: 0,
  sm: 4,
  md: 6,
  lg: 10,
  pill: 999,
} as const;

export const borderWidth = {
  hairline: 1,
  accent: 2, // top-accent on metric cards, left-accent on active nav
} as const;

export type RadiusToken = keyof typeof radius;
