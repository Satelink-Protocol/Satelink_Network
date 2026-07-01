/**
 * @satelink/ui design tokens — TypeScript surface.
 *
 * The CSS variables live in ./tokens.css (imported by ../styles/theme.css
 * into the `.satelink-os` scope). This module is the single programmatic
 * source of truth for state → color mapping: every pill, badge, dot, and
 * threshold indicator resolves its color through `normalizeState` +
 * `STATE_META`. Nothing else in the system may map status strings to colors.
 */

export type SystemState =
  | "healthy"
  | "degraded"
  | "critical"
  | "unknown"
  | "dry-run";

export interface StateMeta {
  /** Human label rendered when no explicit label is supplied. */
  label: string;
  /** `hsl(var(--state-*))` expression for inline styles (charts, SVG). */
  hsl: string;
  /** Utility classes defined in tokens.css. */
  textClass: string;
  bgClass: string;
  pillClass: string;
}

export const STATE_META: Record<SystemState, StateMeta> = {
  healthy: {
    label: "Healthy",
    hsl: "hsl(var(--state-healthy))",
    textClass: "text-state-healthy",
    bgClass: "bg-state-healthy",
    pillClass: "pill-state-healthy",
  },
  degraded: {
    label: "Degraded",
    hsl: "hsl(var(--state-degraded))",
    textClass: "text-state-degraded",
    bgClass: "bg-state-degraded",
    pillClass: "pill-state-degraded",
  },
  critical: {
    label: "Critical",
    hsl: "hsl(var(--state-critical))",
    textClass: "text-state-critical",
    bgClass: "bg-state-critical",
    pillClass: "pill-state-critical",
  },
  unknown: {
    label: "Unknown",
    hsl: "hsl(var(--state-unknown))",
    textClass: "text-state-unknown",
    bgClass: "bg-state-unknown",
    pillClass: "pill-state-unknown",
  },
  "dry-run": {
    label: "Dry Run",
    hsl: "hsl(var(--state-dry-run))",
    textClass: "text-state-dry-run",
    bgClass: "bg-state-dry-run",
    pillClass: "pill-state-dry-run",
  },
};

const STATE_ALIASES: Record<string, SystemState> = {
  healthy: "healthy",
  active: "healthy",
  online: "healthy",
  confirmed: "healthy",
  operational: "healthy",
  ok: "healthy",
  good: "healthy",
  success: "healthy",
  live: "healthy",
  resolved: "healthy",

  degraded: "degraded",
  warning: "degraded",
  pending: "degraded",
  limited: "degraded",
  blocked: "degraded",
  stale: "degraded",

  critical: "critical",
  failed: "critical",
  error: "critical",
  offline: "critical",
  down: "critical",
  bad: "critical",

  "dry-run": "dry-run",
  dry_run: "dry-run",
  dryrun: "dry-run",
  simulated: "dry-run",
};

/**
 * Map any raw status string from an API response to a SystemState.
 * Anything unrecognized is `unknown` (zinc) — never guessed green.
 */
export function normalizeState(raw: string | null | undefined): SystemState {
  if (!raw) return "unknown";
  return STATE_ALIASES[raw.trim().toLowerCase()] ?? "unknown";
}

/** Motion tokens — 120–200ms ease-out only. */
export const MOTION = {
  fast: "140ms",
  slow: "200ms",
  easeOut: "cubic-bezier(0, 0, 0.2, 1)",
} as const;

/** Mono stack used for all metric numerics (`.numeric` utility). */
export const FONT_MONO_NUMERIC =
  '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
