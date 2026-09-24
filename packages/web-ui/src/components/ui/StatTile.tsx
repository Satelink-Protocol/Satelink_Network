// StatTile — a single live KPI. Truth rule (§2.1): NEVER render "—" or a
// placeholder number. It has four explicit states:
//   loading → skeleton
//   error   → "Live data unavailable" + link to status (never a fake value)
//   empty   → same treatment as error (no value to show)
//   ok      → the value (tabular-nums, mono)
import * as React from "react";
import { cn } from "../../lib/utils";

export interface StatTileProps {
  label: string;
  value?: string | number | null;
  /** unit/suffix shown next to the value, e.g. "ms" */
  unit?: string;
  loading?: boolean;
  error?: boolean;
  /** link shown in the error state, defaults to the status page */
  sourceHref?: string;
  sourceLabel?: string;
  className?: string;
}

export function StatTile({
  label,
  value,
  unit,
  loading = false,
  error = false,
  sourceHref = "/status",
  sourceLabel = "View status",
  className,
}: StatTileProps) {
  const unavailable = error || value === null || value === undefined || value === "";
  return (
    <div
      className={cn(
        "rounded-[var(--sl-radius)] border border-sl-border bg-sl-surface p-5",
        className
      )}
    >
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-sl-text-subtle">
        {label}
      </p>
      <div className="mt-2">
        {loading ? (
          <span className="block h-7 w-24 animate-pulse rounded bg-sl-border" aria-hidden />
        ) : unavailable ? (
          <span className="text-sm text-sl-text-muted">
            Live data unavailable —{" "}
            <a href={sourceHref} className="text-sl-accent underline underline-offset-2">
              {sourceLabel}
            </a>
          </span>
        ) : (
          <span className="font-sl-mono text-2xl font-bold tabular-nums text-sl-text">
            {value}
            {unit && <span className="ml-1 text-base font-medium text-sl-text-muted">{unit}</span>}
          </span>
        )}
      </div>
    </div>
  );
}
