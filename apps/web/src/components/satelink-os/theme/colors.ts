/**
 * Satelink-OS color tokens.
 *
 * Single source of truth for JS that needs raw values (recharts series, SVG).
 * The SAME values are mirrored as CSS variables in @satelink/ui theme.css —
 * keep them in sync with that file (the canonical token source). Do not hardcode hex anywhere else in the design system.
 *
 * Brand (Phase 4): teal-forward, never generic enterprise blue.
 */
export const colors = {
  // Brand
  primary: '#2DD4BF', // teal — Satelink identity (@satelink/ui --primary)
  secondary: '#3B82F6', // info blue (@satelink/ui --info)
  accent: '#3B82F6', // info blue — accent duty only

  // Semantic
  success: '#22C55E',
  warn: '#F59E0B',
  danger: '#EF4444',
  info: '#3B82F6',

  // SigNoz-style dark surface hierarchy (bg0 deepest → bg3 raised)
  bg0: '#0A0A0B',
  bg1: '#111113',
  bg2: '#18181B',
  bg3: '#1F1F23',

  // Lines / borders
  border: '#27272A',
  borderStrong: '#3F3F46',

  // Text
  text: '#FAFAFA',
  textMuted: '#A1A1AA',
  textDim: '#71717A',
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
