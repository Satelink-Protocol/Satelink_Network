/**
 * Satelink-OS spacing scale (px). Dense, enterprise-console spacing — mirrors
 * the compact SigNoz/Netdata feel. Mirrored as `--sat-space-*` in theme.css.
 */
export const spacing = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/** Panel/control internal padding defaults. */
export const padding = {
  panel: '12px 14px',
  cell: '6px 10px',
  control: '7px 14px',
  controlSm: '3px 10px',
} as const;

export type SpaceToken = keyof typeof spacing;
