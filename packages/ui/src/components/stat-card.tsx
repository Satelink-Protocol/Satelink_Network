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
    <Card data-slot="stat-card" className={cn("border border-border bg-card flex flex-col justify-center px-3 py-2", className)}>
      <div className="flex items-center gap-2 mb-1">
        {Icon ? (
          <div className="flex items-center justify-center size-6 rounded-md bg-muted text-primary">
            <Icon className="size-3.5" />
          </div>
        ) : null}
        <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground truncate">{label}</span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="flex-1 min-w-0">
          {loading ? (
            <Skeleton className="h-7 w-20 rounded-md bg-muted" />
          ) : (
            <div className="flex flex-col gap-0.5">
              <div
                className={cn(
                  "truncate font-mono text-xl lg:text-2xl font-bold tracking-tight tabular-nums",
                  accent ? "text-primary" : "text-foreground"
                )}
              >
                {value}
              </div>
              {(trend || caption) ? (
                <div className="flex items-center gap-1.5 mt-0.5">
                  {trend ? <MetricTrend {...trend} /> : null}
                  {caption ? (
                    <span className="truncate text-[10px] text-muted-foreground">{caption}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </div>
        {visual ? <div className="shrink-0">{visual}</div> : null}
      </div>
    </Card>
  );
}
