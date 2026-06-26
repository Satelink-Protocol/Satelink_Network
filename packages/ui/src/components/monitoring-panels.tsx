import * as React from "react";
import { cn } from "../lib/utils";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
// Assuming recharts is available if needed, or just standard panels.
// We will build basic skeleton wrappers for these specialized panels as requested.

export interface MonitoringPanelProps {
  title: string;
  description?: string;
  loading?: boolean;
  children?: React.ReactNode;
  className?: string;
}

export function TimeseriesPanel({
  title,
  description,
  loading,
  children,
  className,
}: MonitoringPanelProps) {
  return (
    <Card className={cn("flex flex-col shadow-sm", className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </CardHeader>
      <CardContent className="flex-1 min-h-[200px] flex flex-col justify-end relative">
        {loading ? (
          <Skeleton className="absolute inset-0 m-4 rounded-md" />
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

export function HeatmapPanel({
  title,
  description,
  loading,
  children,
  className,
}: MonitoringPanelProps) {
  return (
    <Card className={cn("flex flex-col shadow-sm", className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </CardHeader>
      <CardContent className="flex-1 min-h-[200px] grid grid-cols-12 gap-1 p-4">
        {loading ? (
          Array.from({ length: 48 }).map((_, i) => (
            <Skeleton key={i} className="w-full aspect-square rounded-sm" />
          ))
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

export function LogPanel({
  title,
  description,
  loading,
  children,
  className,
}: MonitoringPanelProps) {
  return (
    <Card className={cn("flex flex-col shadow-sm overflow-hidden", className)}>
      <CardHeader className="pb-2 border-b border-border/50 bg-muted/10">
        <CardTitle className="text-sm font-medium flex justify-between items-center">
          {title}
        </CardTitle>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </CardHeader>
      <CardContent className="flex-1 min-h-[300px] p-0 overflow-hidden font-mono text-xs bg-black/50 text-muted-foreground">
        {loading ? (
          <div className="p-4 space-y-2">
            <Skeleton className="h-4 w-3/4 opacity-20" />
            <Skeleton className="h-4 w-full opacity-20" />
            <Skeleton className="h-4 w-5/6 opacity-20" />
            <Skeleton className="h-4 w-full opacity-20" />
            <Skeleton className="h-4 w-2/3 opacity-20" />
          </div>
        ) : (
          <div className="p-4 h-full overflow-y-auto space-y-1">
            {children}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
