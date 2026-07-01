import * as React from "react";

import { cn } from "../lib/utils";
import {
  normalizeState,
  STATE_META,
  type SystemState,
} from "../tokens";

export interface StatusPillProps {
  /** Raw status string from an API response (e.g. "active", "dry_run"). */
  status: string | null | undefined;
  /** Override the auto-normalized state. */
  state?: SystemState;
  /** Override the rendered text (defaults to the raw status). */
  label?: string;
  /** Hide the leading state dot. */
  hideDot?: boolean;
  className?: string;
}

/**
 * THE status pill. Resolves color exclusively through normalizeState +
 * STATE_META (tokens/) — green healthy / amber degraded / red critical /
 * zinc unknown / violet dry-run. Unrecognized statuses render zinc, never
 * a guessed green.
 */
export function StatusPill({
  status,
  state,
  label,
  hideDot = false,
  className,
}: StatusPillProps) {
  const resolved = state ?? normalizeState(status);
  const meta = STATE_META[resolved];
  return (
    <span
      data-slot="status-pill"
      data-state={resolved}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider transition-tokens",
        meta.pillClass,
        className
      )}
    >
      {!hideDot && (
        <span className={cn("size-1.5 shrink-0 rounded-full", meta.bgClass)} />
      )}
      {label ?? status ?? meta.label}
    </span>
  );
}

export interface HealthBadgeProps {
  /** Raw status string; normalized via tokens. */
  status: string | null | undefined;
  state?: SystemState;
  label?: string;
  /** Pulse the dot (opacity-only) for live-updating surfaces. */
  pulse?: boolean;
  className?: string;
}

/**
 * Minimal dot + label health indicator for headers and dense rows.
 * Same single color source as StatusPill.
 */
export function HealthBadge({
  status,
  state,
  label,
  pulse = false,
  className,
}: HealthBadgeProps) {
  const resolved = state ?? normalizeState(status);
  const meta = STATE_META[resolved];
  return (
    <span
      data-slot="health-badge"
      data-state={resolved}
      className={cn("inline-flex items-center gap-2 text-xs font-medium", className)}
    >
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          meta.bgClass,
          pulse && resolved !== "unknown" && "animate-pulse-glow"
        )}
      />
      <span className={meta.textClass}>{label ?? status ?? meta.label}</span>
    </span>
  );
}
