/**
 * Satelink-OS color tokens (Elevated to @satelink/ui).
 *
 * Single source of truth for JS that needs raw values (recharts series, SVG).
 */
export const colors = {
  // Brand
  primary: '#5EEAD4',
  secondary: '#00C8FF',
  accent: '#0090FF',

  // Semantic
  success: '#34D399',
  warn: '#F59E0B',
  danger: '#EF4444',
  info: '#7DD3FC',

  // Backgrounds
  bg0: '#050816',
  bg1: '#0E1628',
  bg2: '#121C33',
  bg3: '#1A2740',

  // Borders
  border: '#1A2F50',
  borderStrong: '#26406B',

  // Text
  text: '#E5EEF8',
  textMuted: '#94A3B8',
  textDim: '#4A5A72',
} as const;

export const chartPalette = [
  colors.primary,
  colors.secondary,
  colors.accent,
  colors.success,
  colors.warn,
  colors.info,
] as const;

export type ColorToken = keyof typeof colors;
