/**
 * Satelink-OS color tokens.
 *
 * Single source of truth for JS that needs raw values (recharts series, SVG).
 * The SAME values are mirrored as CSS variables in `theme.css` — keep them in
 * sync. Do not hardcode hex anywhere else in the design system.
 *
 * Brand (Phase 4): teal-forward, never generic enterprise blue.
 */
export const colors = {
  // Brand
  primary: '#5EEAD4', // teal — Satelink identity
  secondary: '#00C8FF', // cyan
  accent: '#0090FF', // azure (accent only, not the dominant blue)

  // Semantic
  success: '#34D399',
  warn: '#F59E0B',
  danger: '#EF4444',
  info: '#7DD3FC',

  // SigNoz-style dark surface hierarchy (bg0 deepest → bg3 raised)
  bg0: '#050816',
  bg1: '#0E1628',
  bg2: '#121C33',
  bg3: '#1A2740',

  // Lines / borders
  border: '#1A2F50',
  borderStrong: '#26406B',

  // Text
  text: '#E5EEF8',
  textMuted: '#94A3B8',
  textDim: '#4A5A72',
} as const;

/** Ordered palette for chart series (teal-forward, brand-consistent). */
export const chartPalette = [
  colors.primary,
  colors.secondary,
  colors.accent,
  colors.success,
  colors.warn,
  colors.info,
] as const;

export type ColorToken = keyof typeof colors;
