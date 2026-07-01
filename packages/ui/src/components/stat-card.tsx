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
    <Card data-slot="stat-card" className={cn("flex flex-col gap-2 p-4", className)}>
      <div className="flex items-start justify-between">
        <span className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">{label}</span>
        {Icon ? <Icon className="size-4 text-muted-foreground" /> : null}
      </div>
      <div className="flex items-end justify-between gap-3 mt-2">
        <div className="min-w-0">
          {loading ? (
            <Skeleton className="h-8 w-24 rounded bg-zinc-800/50" />
          ) : (
            <div
              className={cn(
                "truncate font-mono text-2xl text-white tabular-nums leading-none",
                accent ? "text-[hsl(174,80%,38%)]" : ""
              )}
            >
              {value}
            </div>
          )}
        </div>
        {visual ? <div className="shrink-0">{visual}</div> : null}
      </div>
      {(trend || caption || loading) ? (
        <div className="flex items-center justify-between mt-2 min-h-[16px]">
          {loading ? (
            <Skeleton className="h-3 w-32 rounded bg-zinc-800/50" />
          ) : (
            <>
              {caption ? (
                <span className="truncate text-xs text-muted-foreground">{caption}</span>
              ) : <span />}
              {trend ? <MetricTrend {...trend} /> : null}
            </>
          )}
        </div>
      ) : null}
    </Card>
  );
}
