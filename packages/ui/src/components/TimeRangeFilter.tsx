"use client";

/**
 * Dashboard filter primitives — the single shared source for time-window and
 * contextual filters across every Satelink subdomain dashboard (admin, developer,
 * machine, ops). Built from semantic tokens only (no hardcoded colors), matching
 * the @satelink/ui design system.
 *
 * TimeRangeFilter maps 1:1 to the API `?window=` param added on
 * /admin/executive/summary and /admin/demand/stats (1h|24h|7d|30d|custom).
 * Custom emits ISO-8601 `from`/`to` bounds; pages forward them as
 * `?window=custom&from=<ISO>&to=<ISO>`.
 */

import * as React from "react";
import { cn } from "../lib/utils";

// ── Segmented control (shared base) ────────────────────────────────────────
export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md border border-border bg-muted/40 p-0.5",
        className
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded px-2.5 py-1 text-xs font-medium transition-colors outline-none",
              "focus-visible:ring-[3px] focus-visible:ring-ring/40",
              active
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Time range filter ──────────────────────────────────────────────────────
export type TimeWindow = "1h" | "24h" | "7d" | "30d" | "custom";

export interface TimeRangeFilterProps {
  value: TimeWindow;
  /** Emitted on every selection change. For `custom`, from/to are ISO strings. */
  onChange: (value: TimeWindow, from?: string, to?: string) => void;
  customFrom?: string;
  customTo?: string;
  className?: string;
}

const TIME_OPTIONS: SegmentedOption<TimeWindow>[] = [
  { value: "1h", label: "1H" },
  { value: "24h", label: "24H" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "custom", label: "Custom" },
];

/** Convert an ISO string to the `datetime-local` input value (no seconds/zone). */
function toLocalInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  // Render in local time, trimmed to minutes, for the datetime-local control.
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60_000);
  return local.toISOString().slice(0, 16);
}

/** Convert a `datetime-local` value back to a full ISO-8601 (UTC) string. */
function fromLocalInput(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function TimeRangeFilter({
  value,
  onChange,
  customFrom,
  customTo,
  className,
}: TimeRangeFilterProps) {
  const handleSelect = (v: TimeWindow) => {
    if (v === "custom") {
      // Preserve any existing custom bounds; parent supplies them back.
      onChange("custom", customFrom, customTo);
    } else {
      onChange(v);
    }
  };

  const handleCustom = (which: "from" | "to", localValue: string) => {
    const iso = fromLocalInput(localValue);
    const nextFrom = which === "from" ? iso : customFrom;
    const nextTo = which === "to" ? iso : customTo;
    onChange("custom", nextFrom, nextTo);
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Segmented
        ariaLabel="Time range"
        options={TIME_OPTIONS}
        value={value}
        onChange={handleSelect}
      />
      {value === "custom" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="datetime-local"
            aria-label="Custom range start"
            value={toLocalInput(customFrom)}
            max={toLocalInput(customTo) || undefined}
            onChange={(e) => handleCustom("from", e.target.value)}
            className="h-8 rounded-md border border-input bg-transparent px-2 text-xs text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          />
          <span className="text-xs text-muted-foreground">→</span>
          <input
            type="datetime-local"
            aria-label="Custom range end"
            value={toLocalInput(customTo)}
            min={toLocalInput(customFrom) || undefined}
            onChange={(e) => handleCustom("to", e.target.value)}
            className="h-8 rounded-md border border-input bg-transparent px-2 text-xs text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          />
        </div>
      )}
    </div>
  );
}

// ── Classification filter (admin) ──────────────────────────────────────────
export type Classification = "all" | "machine" | "developer" | "unknown";

export interface ClassificationFilterProps {
  value: Classification;
  onChange: (value: Classification) => void;
  className?: string;
}

const CLASSIFICATION_OPTIONS: SegmentedOption<Classification>[] = [
  { value: "all", label: "All" },
  { value: "machine", label: "Machine" },
  { value: "developer", label: "Developer" },
  { value: "unknown", label: "Unknown" },
];

export function ClassificationFilter({ value, onChange, className }: ClassificationFilterProps) {
  return (
    <Segmented
      ariaLabel="Classification"
      options={CLASSIFICATION_OPTIONS}
      value={value}
      onChange={onChange}
      className={className}
    />
  );
}

// ── Spend threshold filter (machine) ───────────────────────────────────────
export type SpendThreshold = "all" | "0.001" | "0.01";

export interface SpendThresholdFilterProps {
  value: SpendThreshold;
  onChange: (value: SpendThreshold) => void;
  className?: string;
}

const SPEND_OPTIONS: SegmentedOption<SpendThreshold>[] = [
  { value: "all", label: "All" },
  { value: "0.001", label: ">$0.001" },
  { value: "0.01", label: ">$0.01" },
];

export function SpendThresholdFilter({ value, onChange, className }: SpendThresholdFilterProps) {
  return (
    <Segmented
      ariaLabel="Spend threshold"
      options={SPEND_OPTIONS}
      value={value}
      onChange={onChange}
      className={className}
    />
  );
}

// ── Helper: build the API query string for a window selection ──────────────
/**
 * Serialize a window selection into URLSearchParams entries. Pages append these
 * to every data endpoint so useEndpoint re-fetches when the filter changes.
 */
export function windowParams(
  window: TimeWindow,
  from?: string,
  to?: string
): Record<string, string> {
  if (window === "custom" && from && to) {
    return { window: "custom", from, to };
  }
  return { window: window === "custom" ? "24h" : window };
}
