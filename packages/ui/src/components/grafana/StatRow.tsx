import * as React from "react";
import { cn } from "../../lib/utils";

export interface StatRowItem {
  label: string;
  value: string | number;
  unit?: string;
  status?: "good" | "warning" | "critical" | "neutral";
  colorize?: boolean;
}

export interface StatRowProps {
  stats: StatRowItem[];
  className?: string;
}

export function StatRow({ stats, className }: StatRowProps) {
  return (
    <div
      className={cn(
        "flex w-full items-stretch overflow-hidden rounded-md border border-border bg-[hsl(var(--card))] shadow-sm divide-x divide-border",
        className
      )}
    >
      {stats.map((stat, i) => {
        const { label, value, unit, status = "neutral", colorize } = stat;

        // Determine base classes
        let bgClass = "bg-transparent";
        let textClass = "text-foreground";
        
        // Define color mappings for the value and background
        if (status === "good") {
          textClass = "text-success";
          if (colorize) bgClass = "bg-success/10";
        } else if (status === "warning") {
          textClass = "text-warning";
          if (colorize) bgClass = "bg-warning/10";
        } else if (status === "critical") {
          textClass = "text-destructive";
          if (colorize) bgClass = "bg-destructive/10";
        } else {
          // Neutral
          textClass = "text-foreground";
          if (colorize) bgClass = "bg-muted/30";
        }

        return (
          <div
            key={i}
            className={cn(
              "flex flex-1 min-w-0 flex-col p-3 transition-colors",
              bgClass
            )}
          >
            <div className="flex items-baseline gap-1 mt-1 mb-0.5 metric-value">
              <span className={cn("text-[24px] font-bold leading-none", textClass)}>
                {value}
              </span>
              {unit && (
                <span className={cn("text-xs font-medium opacity-80", textClass)}>
                  {unit}
                </span>
              )}
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground truncate">
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
