import * as React from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { cn } from "../../lib/utils";
import { Card, CardContent } from "../ui/card";
import { Skeleton } from "../ui/skeleton";

export interface SparklineKPICardProps {
  label: string;
  value: string | number;
  unit?: string;
  caption?: string;
  icon?: React.ComponentType<{ className?: string }>;
  sparkData?: number[];
  sparkColor?: string;
  status?: "good" | "warning" | "critical" | "neutral";
  trend?: number;
  loading?: boolean;
  className?: string;
}

export function SparklineKPICard({
  label,
  value,
  unit,
  caption,
  icon: Icon,
  sparkData,
  sparkColor,
  status = "neutral",
  trend,
  loading = false,
  className,
}: SparklineKPICardProps) {
  // Map status to semantic colors
  const statusColors = {
    good: "hsl(var(--success))",
    warning: "hsl(var(--warning))",
    critical: "hsl(var(--destructive))",
    neutral: "hsl(var(--primary))",
  };

  const statusGradients = {
    good: "from-success via-success/60 to-transparent",
    warning: "from-warning via-warning/60 to-transparent",
    critical: "from-destructive via-destructive/60 to-transparent",
    neutral: "from-primary via-primary/60 to-transparent",
  };

  const activeColor = sparkColor || statusColors[status];
  const accentGradient = statusGradients[status];

  // Map array of numbers to recharts format
  const chartData = React.useMemo(() => {
    return sparkData?.map((val, i) => ({ value: val, index: i })) || [];
  }, [sparkData]);

  return (
    <Card
      className={cn(
        "relative overflow-hidden panel-hover border-[hsl(var(--card-border))] shadow-[var(--card-shadow)]",
        className
      )}
    >
      {/* Grafana-style top accent line */}
      <div
        className={cn(
          "absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r",
          accentGradient
        )}
      />

      <CardContent className="p-5 pt-6 flex flex-col h-full">
        <div className="flex items-start justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground z-10">
            {label}
          </span>
          {Icon && (
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted/50 ring-1 ring-border z-10">
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
          )}
        </div>

        {loading ? (
          <div className="mt-3 h-8 w-24 animate-pulse rounded bg-muted z-10" />
        ) : (
          <div className="metric-value mt-2 text-[32px] font-bold leading-none text-foreground z-10 flex items-baseline gap-1">
            {value}
            {unit && (
              <span
                className="text-sm font-medium opacity-70"
                style={{ color: activeColor }}
              >
                {unit}
              </span>
            )}
          </div>
        )}

        {/* The Sparkline (absolutely positioned at the bottom but above background, below text) */}
        {!loading && chartData.length > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-[40px] opacity-40 pointer-events-none z-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={`spark-${label}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={activeColor} stopOpacity={0.8} />
                    <stop offset="100%" stopColor={activeColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={activeColor}
                  strokeWidth={2}
                  fill={`url(#spark-${label})`}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="mt-auto pt-4 flex items-center justify-between z-10 relative">
          <div className="flex items-center gap-2">
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{
                backgroundColor: activeColor,
                boxShadow: `0 0 6px ${activeColor}`,
              }}
            />
            {caption && (
              <span className="text-[11px] text-muted-foreground">{caption}</span>
            )}
          </div>
          
          {trend !== undefined && trend !== null && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                trend >= 0
                  ? "bg-success/15 text-success"
                  : "bg-destructive/15 text-destructive"
              )}
            >
              {trend >= 0 ? "▲" : "▼"} {Math.abs(trend)}%
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
