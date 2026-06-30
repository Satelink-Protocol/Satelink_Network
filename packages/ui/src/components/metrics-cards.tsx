import * as React from "react";
import { type LucideIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { Card, CardContent } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import { MetricTrend, type MetricTrendProps } from "./metric-trend";

// -------------------------------------------------------------------------
// KPICard
// For high-level key performance indicators (e.g., Total Revenue, Active Nodes)
// -------------------------------------------------------------------------
export interface KPICardProps {
  label: string;
  value: React.ReactNode;
  caption?: string;
  /** Renders top-right inside a subtle primary-tinted box when provided. */
  icon?: React.ComponentType<{ className?: string }>;
  /** Optional detailed trend rendered bottom-left (legacy, backward compatible). */
  trend?: MetricTrendProps;
  /** Optional signed percentage; renders a colored pill (+green / -red) bottom-right. */
  trendValue?: number;
  loading?: boolean;
  className?: string;
}

export function KPICard({
  label,
  value,
  caption,
  icon: Icon,
  trend,
  trendValue,
  loading = false,
  className,
}: KPICardProps) {
  return (
    <Card className={cn(
      'relative overflow-hidden panel-hover border-[hsl(var(--card-border))] shadow-[var(--card-shadow)]',
      className
    )}>
      {/* Grafana-style top accent line */}
      <div className='absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-primary via-primary/60 to-transparent' />
      
      <CardContent className='p-5 pt-6'>
        <div className='flex items-start justify-between'>
          <span className='text-[11px] font-semibold uppercase tracking-widest text-muted-foreground'>
            {label}
          </span>
          {Icon && (
            <div className='flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 ring-1 ring-primary/20'>
              <Icon className='h-3.5 w-3.5 text-primary' />
            </div>
          )}
        </div>
        
        {loading ? (
          <div className='mt-3 h-8 w-24 animate-pulse rounded bg-muted' />
        ) : (
          <div className='metric-value mt-2 text-[28px] font-bold leading-none text-foreground'>
            {value}
          </div>
        )}
        
        <div className='mt-2 flex items-center justify-between'>
          {caption && (
            <span className='text-[11px] text-muted-foreground'>{caption}</span>
          )}
          {trendValue !== undefined && trendValue !== null && (
            <span className={cn(
              'inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
              trendValue >= 0 
                ? 'bg-success/15 text-success' 
                : 'bg-destructive/15 text-destructive'
            )}>
              {trendValue >= 0 ? '▲' : '▼'} {Math.abs(trendValue)}%
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// -------------------------------------------------------------------------
// StatusCard
// For system health, operational status, or boolean states
// -------------------------------------------------------------------------
export interface StatusCardProps {
  label: string;
  statusText: string;
  status: "success" | "warning" | "destructive" | "muted" | "primary";
  icon?: LucideIcon;
  description?: string;
  loading?: boolean;
  className?: string;
}

export function StatusCard({
  label,
  statusText,
  status,
  icon: Icon,
  description,
  loading = false,
  className,
}: StatusCardProps) {
  const statusColor = {
    success: "bg-success",
    warning: "bg-warning",
    destructive: "bg-destructive",
    muted: "bg-muted-foreground",
    primary: "bg-primary",
  }[status];

  return (
    <Card className={cn("flex flex-col gap-3 p-5 shadow-sm", className)}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium tracking-tight text-muted-foreground">{label}</span>
        {Icon ? <Icon className="size-4 text-muted-foreground" /> : null}
      </div>
      <div className="flex items-center gap-3">
        {loading ? (
          <Skeleton className="h-6 w-20 rounded-md" />
        ) : (
          <>
            <span className={cn("relative flex size-3")}>
              <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-75", statusColor)} />
              <span className={cn("relative inline-flex size-3 rounded-full", statusColor)} />
            </span>
            <span className="text-lg font-semibold tracking-tight text-foreground">{statusText}</span>
          </>
        )}
      </div>
      {description && !loading ? (
        <p className="text-xs text-muted-foreground">{description}</p>
      ) : null}
    </Card>
  );
}

// -------------------------------------------------------------------------
// MetricCard
// For detailed metrics often paired with a visual sparkline or progress bar
// -------------------------------------------------------------------------
export interface MetricCardProps {
  label: string;
  value: string;
  visual?: React.ReactNode; // e.g. a small Recharts AreaChart
  footer?: React.ReactNode;
  loading?: boolean;
  className?: string;
}

export function MetricCard({
  label,
  value,
  visual,
  footer,
  loading = false,
  className,
}: MetricCardProps) {
  return (
    <Card className={cn("flex flex-col p-5 shadow-sm overflow-hidden relative", className)}>
      <div className="flex flex-col gap-1 z-10">
        <span className="text-sm font-medium tracking-tight text-muted-foreground">{label}</span>
        {loading ? (
          <Skeleton className="h-7 w-20 rounded-md mt-1" />
        ) : (
          <span className="font-mono text-xl font-bold tracking-tight text-foreground">{value}</span>
        )}
      </div>
      
      {visual && !loading && (
        <div className="absolute bottom-0 right-0 left-0 h-16 opacity-50 z-0 pointer-events-none">
          {visual}
        </div>
      )}
      
      {footer && !loading && (
        <div className="mt-4 z-10 text-xs text-muted-foreground border-t border-border/50 pt-3">
          {footer}
        </div>
      )}
    </Card>
  );
}
