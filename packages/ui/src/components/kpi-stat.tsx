"use client";

import * as React from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";

import { cn } from "../lib/utils";
import { Skeleton } from "./ui/skeleton";
import { STATE_META, type SystemState } from "../tokens";

export interface KPIStatProps {
  label: string;
  /**
   * The metric. `null`/`undefined` renders the honest empty value "—" —
   * never a placeholder number.
   */
  value: string | number | null | undefined;
  unit?: string;
  /** Signed percentage; renders ▲ green / ▼ red. Omit when unknown. */
  delta?: number | null;
  /** Real datapoints only. Omit (no sparkline) when history doesn't exist. */
  sparkline?: number[];
  /** Threshold state — drives the accent edge + dot. Default "unknown". */
  state?: SystemState;
  /** Time-window label, e.g. "24h", "MTD". */
  timeWindow?: string;
  caption?: string;
  icon?: React.ComponentType<{ className?: string }>;
  loading?: boolean;
  error?: string | null;
  className?: string;
}

/**
 * Grafana-style single-stat: mono numerics, state-colored accent edge,
 * subtle low-opacity sparkline. loading → skeleton, no value → "—",
 * error → inline error note. The value must trace to a real API response.
 */
export function KPIStat({
  label,
  value,
  unit,
  delta,
  sparkline,
  state = "unknown",
  timeWindow,
  caption,
  icon: Icon,
  loading = false,
  error,
  className,
}: KPIStatProps) {
  const meta = STATE_META[state];
  const sparkId = React.useId();
  const hasValue = value !== null && value !== undefined && value !== "";
  const chartData = React.useMemo(
    () => (sparkline ?? []).map((v, i) => ({ value: v, index: i })),
    [sparkline]
  );

  return (
    <div
      data-slot="kpi-stat"
      data-state={state}
      className={cn(
        "relative flex flex-col overflow-hidden rounded-lg border border-[hsl(var(--card-border))] bg-card p-4 shadow-[var(--elev-panel)] transition-tokens panel-hover",
        className
      )}
    >
      {/* state accent edge */}
      <div
        className="absolute inset-y-0 left-0 w-[2px]"
        style={{ backgroundColor: meta.hsl, opacity: state === "unknown" ? 0.35 : 0.9 }}
      />

      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
          {timeWindow ? (
            <span className="ml-1.5 rounded border border-border bg-muted/50 px-1 py-px font-mono text-[9px] normal-case tracking-normal">
              {timeWindow}
            </span>
          ) : null}
        </span>
        {Icon ? (
          <span className="flex size-6 items-center justify-center rounded-md bg-muted/50 ring-1 ring-border">
            <Icon className="size-3 text-muted-foreground" />
          </span>
        ) : null}
      </div>

      {loading ? (
        <Skeleton className="mt-2 h-8 w-24" />
      ) : error ? (
        <span className="numeric mt-2 text-sm text-state-critical">{error}</span>
      ) : (
        <span className="numeric mt-2 flex items-baseline gap-1 text-[28px] font-bold leading-none text-foreground">
          {hasValue ? value : "—"}
          {hasValue && unit ? (
            <span className="text-sm font-medium text-muted-foreground">{unit}</span>
          ) : null}
        </span>
      )}

      {/* sparkline — real history only, subtle low-opacity fill */}
      {!loading && !error && chartData.length > 1 ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-9 opacity-30">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={sparkId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={meta.hsl} stopOpacity={0.7} />
                  <stop offset="100%" stopColor={meta.hsl} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="value"
                stroke={meta.hsl}
                strokeWidth={1.5}
                fill={`url(#${sparkId})`}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      <div className="relative mt-auto flex items-center justify-between pt-3">
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span
            className="inline-block size-1.5 rounded-full"
            style={{ backgroundColor: meta.hsl }}
          />
          {caption ?? meta.label}
        </span>
        {!loading && !error && typeof delta === "number" ? (
          <span
            className={cn(
              "numeric inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold",
              delta >= 0
                ? "bg-[hsl(var(--state-healthy)/0.12)] text-state-healthy"
                : "bg-[hsl(var(--state-critical)/0.12)] text-state-critical"
            )}
          >
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}%
          </span>
        ) : null}
      </div>
    </div>
  );
}
