import * as React from "react";
import { cn } from "../lib/utils";
import { Skeleton } from "./ui/skeleton";

export interface MonitoringPanelProps {
  title: string;
  description?: string;
  loading?: boolean;
  children?: React.ReactNode;
  className?: string;
  /** Optional pill/badge to show in the header right */
  headerRight?: React.ReactNode;
}

// -------------------------------------------------------------------------
// TimeseriesPanel
// Grafana-style: dark header bar, uppercase title, optional description
// -------------------------------------------------------------------------
export function TimeseriesPanel({
  title,
  description,
  loading,
  children,
  className,
  headerRight,
}: MonitoringPanelProps) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-md border border-border bg-card overflow-hidden shadow-sm",
        className
      )}
    >
      {/* Panel header — Grafana dark bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30 gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground truncate">
            {title}
          </span>
          {description && (
            <span className="text-[9px] text-muted-foreground/60 truncate">{description}</span>
          )}
        </div>
        {headerRight && <div className="shrink-0">{headerRight}</div>}
      </div>

      {/* Chart area */}
      <div className="flex-1 min-h-[200px] flex flex-col justify-end relative p-3">
        {loading ? (
          <Skeleton className="absolute inset-3 rounded-md opacity-30" />
        ) : (
          children
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------
// HeatmapPanel
// Dense grid display — Grafana heatmap panel style
// -------------------------------------------------------------------------
export function HeatmapPanel({
  title,
  description,
  loading,
  children,
  className,
  headerRight,
}: MonitoringPanelProps) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-md border border-border bg-card overflow-hidden shadow-sm",
        className
      )}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30 gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground truncate">
            {title}
          </span>
          {description && (
            <span className="text-[9px] text-muted-foreground/60 truncate">{description}</span>
          )}
        </div>
        {headerRight && <div className="shrink-0">{headerRight}</div>}
      </div>
      <div className="flex-1 min-h-[200px] grid grid-cols-12 gap-1 p-3">
        {loading
          ? Array.from({ length: 48 }).map((_, i) => (
              <Skeleton key={i} className="w-full aspect-square rounded-[1px] opacity-20" />
            ))
          : children}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------
// LogPanel
// Terminal-style log stream — dark background, colour-coded log levels,
// monospace font, line numbers (SigNoz / Datadog Logs style)
// -------------------------------------------------------------------------
export interface LogEntry {
  ts?: string;
  level?: "error" | "warn" | "info" | "debug" | "trace";
  msg: string;
}

const LOG_LEVEL_COLOR: Record<NonNullable<LogEntry["level"]>, string> = {
  error: "text-red-400",
  warn:  "text-yellow-400",
  info:  "text-primary",
  debug: "text-muted-foreground",
  trace: "text-muted-foreground/50",
};

export function LogPanel({
  title,
  description,
  loading,
  children,
  className,
  headerRight,
}: MonitoringPanelProps) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-md border border-border bg-card overflow-hidden shadow-sm",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {/* Terminal dots */}
          <div className="flex gap-1 shrink-0">
            <span className="w-2 h-2 rounded-full bg-red-500/60" />
            <span className="w-2 h-2 rounded-full bg-yellow-500/60" />
            <span className="w-2 h-2 rounded-full bg-green-500/60" />
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground truncate">
            {title}
          </span>
          {description && (
            <span className="text-[9px] text-muted-foreground/60 truncate hidden sm:inline">
              {description}
            </span>
          )}
        </div>
        {headerRight && <div className="shrink-0">{headerRight}</div>}
      </div>

      {/* Log body */}
      <div className="flex-1 min-h-[300px] overflow-hidden bg-background/80">
        {loading ? (
          <div className="p-4 space-y-2">
            <Skeleton className="h-3.5 w-3/4 opacity-10" />
            <Skeleton className="h-3.5 w-full opacity-10" />
            <Skeleton className="h-3.5 w-5/6 opacity-10" />
            <Skeleton className="h-3.5 w-full opacity-10" />
            <Skeleton className="h-3.5 w-2/3 opacity-10" />
          </div>
        ) : (
          <div className="h-full overflow-y-auto p-3 space-y-0.5 font-mono text-[11px]">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A pre-formatted log line for use inside LogPanel.
 * Usage: <LogLine level="info" ts="12:34:05.123" msg="Connection established" />
 */
export function LogLine({ ts, level = "info", msg }: LogEntry) {
  const levelColor = LOG_LEVEL_COLOR[level];
  return (
    <div className="flex items-start gap-2 leading-[1.6] hover:bg-muted/20 px-1 rounded-[2px] transition-colors">
      {ts && (
        <span className="shrink-0 text-muted-foreground/40 tabular-nums w-[88px]">{ts}</span>
      )}
      <span className={cn("shrink-0 font-bold uppercase w-10", levelColor)}>
        {level.slice(0, 4)}
      </span>
      <span className="text-foreground/80 break-all">{msg}</span>
    </div>
  );
}

