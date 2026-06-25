import * as React from "react";
import { type LucideIcon } from "lucide-react";

import { cn } from "../lib/utils";
import { Card } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import { MetricTrend, type MetricTrendProps } from "./metric-trend";

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  /** Small caption under the value (e.g. "vs last 30 days"). */
  caption?: string;
  icon?: LucideIcon;
  trend?: MetricTrendProps;
  /** Tint the value emerald (positive headline figures). */
  accent?: boolean;
  loading?: boolean;
  /** Optional right-side slot (e.g. a sparkline). */
  visual?: React.ReactNode;
  className?: string;
}

/**
 * The canonical KPI tile for the dashboard — finance-reference density:
 * muted label, large tabular value, trend pill, caption. Compose via KPIGrid.
 */
export function StatCard({
  label,
  value,
  caption,
  icon: Icon,
  trend,
  accent = false,
  loading = false,
  visual,
  className,
}: StatCardProps) {
  return (
    <Card data-slot="stat-card" className={cn("glow-card glass-panel flex flex-col gap-2 py-3", className)}>
      <div className="flex items-center justify-between px-4">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</span>
        {Icon ? <Icon className="size-3.5 text-muted-foreground" /> : null}
      </div>
      <div className="flex items-end justify-between gap-3 px-4">
        <div className="min-w-0">
          {loading ? (
            <Skeleton className="h-7 w-24 rounded-md bg-muted/60" />
          ) : (
            <div
              className={cn(
                "truncate font-mono text-xl font-bold tracking-tight tabular-nums",
                accent ? "text-primary" : "text-foreground"
              )}
            >
              {value}
            </div>
          )}
        </div>
        {visual ? <div className="shrink-0">{visual}</div> : null}
      </div>
      {(trend || caption || loading) ? (
        <div className="flex items-center gap-2 px-4 mt-0.5">
          {loading ? (
            <Skeleton className="h-3 w-32 rounded-md bg-muted/50" />
          ) : (
            <>
              {trend ? <MetricTrend {...trend} /> : null}
              {caption ? (
                <span className="truncate text-xs text-muted-foreground">{caption}</span>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </Card>
  );
}
