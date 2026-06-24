/**
 * Satelink-OS token aggregate. Import from here for JS-side token access.
 * For styling, prefer the CSS variables (`var(--sat-*)`) in `*.module.css`.
 */
import { borderWidth, radius } from './borders';
import { chartPalette, colors } from './colors';
import { elevation } from './elevation';
import { padding, spacing } from './spacing';
import {
  fontFamily,
  fontWeight,
  letterSpacing,
  typeScale,
} from './typography';

export const tokens = {
  colors,
  chartPalette,
  spacing,
  padding,
  fontFamily,
  typeScale,
  letterSpacing,
  fontWeight,
  elevation,
  radius,
  borderWidth,
} as const;

export type Tokens = typeof tokens;
