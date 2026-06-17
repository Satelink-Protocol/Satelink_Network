/**
 * Satelink-OS typography scale.
 *
 * Two families (Phase 4):
 *   sans = Geist Sans          → UI, labels, tables, body
 *   mono = JetBrains Mono      → operational data, metrics, logs, addresses
 *          (Geist Mono fallback so builds never depend on a network font fetch)
 *
 * Families are exposed as CSS vars `--sat-font-sans` / `--sat-font-mono` (set in
 * theme.css and bound to the geist font variables by the route layout).
 */
export const fontFamily = {
  sans: 'var(--sat-font-sans)',
  mono: 'var(--sat-font-mono)',
} as const;

/** Type scale: [fontSize px, lineHeight]. */
export const typeScale = {
  display: { size: 28, line: 1 }, // metric values
  h1: { size: 18, line: 1.2 }, // page title
  h2: { size: 14, line: 1.3 }, // section title
  body: { size: 12, line: 1.5 }, // body text
  small: { size: 11, line: 1.4 }, // table cells, secondary
  label: { size: 9, line: 1.2 }, // mono uppercase labels (letter-spacing 2–3)
  data: { size: 10, line: 1.4 }, // logs / event stream
} as const;

export const letterSpacing = {
  label: 3,
  header: 2,
  control: 1,
} as const;

export const fontWeight = {
  regular: 400,
  medium: 600,
  bold: 700,
} as const;

export type TypeToken = keyof typeof typeScale;
