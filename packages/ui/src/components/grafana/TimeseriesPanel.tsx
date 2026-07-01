import * as React from "react";
import {
  ComposedChart,
  Line,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from "recharts";
import { Activity } from "lucide-react";
import { cn } from "../../lib/utils";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardAction } from "../ui/card";
import { Button } from "../ui/button";

export interface TimeseriesSeries {
  key: string;
  label: string;
  color?: string;
  type?: "line" | "area" | "bar";
}

export interface TimeseriesPanelProps {
  title: string;
  subtitle?: string;
  data: Array<{ ts: number; [key: string]: any }>;
  series: TimeseriesSeries[];
  timeRange?: "1h" | "6h" | "24h" | "7d" | "30d";
  onTimeRangeChange?: (range: "1h" | "6h" | "24h" | "7d" | "30d") => void;
  height?: number;
  showLegend?: boolean;
  loading?: boolean;
  /** Error message — renders the error treatment instead of the chart. */
  error?: string | null;
  emptyHint?: string;
  className?: string;
}

export function TimeseriesPanel({
  title,
  subtitle,
  data,
  series,
  timeRange,
  onTimeRangeChange,
  height = 240,
  showLegend = true,
  loading = false,
  error,
  emptyHint,
  className,
}: TimeseriesPanelProps) {
  const chartColors = [
    "hsl(var(--chart-1))",
    "hsl(var(--chart-2))",
    "hsl(var(--chart-3))",
    "hsl(var(--chart-4))",
    "hsl(var(--chart-5))",
    "hsl(var(--chart-6))",
  ];

  // Helper to format timestamps based on range
  const formatTime = (ts: number) => {
    const d = new Date(ts);
    if (!timeRange) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (["1h", "6h", "24h"].includes(timeRange)) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
  };

  const ranges: Array<"1h" | "6h" | "24h" | "7d" | "30d"> = ["1h", "6h", "24h", "7d", "30d"];

  const hasData = data && data.length > 0;

  return (
    <Card className={cn("overflow-hidden panel-hover", className)}>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <CardTitle>{title}</CardTitle>
            {subtitle && <CardDescription>{subtitle}</CardDescription>}
          </div>
          
          {timeRange && (
            <CardAction>
              <div className="flex items-center p-0.5 rounded-md bg-muted/50 border border-border">
                {ranges.map((range) => (
                  <Button
                    key={range}
                    variant="ghost"
                    size="sm"
                    onClick={() => onTimeRangeChange?.(range)}
                    className={cn(
                      "h-6 px-2.5 text-[10px] uppercase font-semibold tracking-wider rounded-sm transition-all",
                      timeRange === range
                        ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/80"
                    )}
                  >
                    {range}
                  </Button>
                ))}
              </div>
            </CardAction>
          )}
        </div>
      </CardHeader>
      
      <CardContent className="pt-0 pb-4">
        <div style={{ height }} className="w-full relative mt-2">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm z-10 rounded-md" aria-busy="true">
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <span className="text-xs font-medium">Loading data...</span>
              </div>
            </div>
          ) : error ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground rounded-md border border-dashed border-destructive/40 bg-destructive/5" role="alert">
              <Activity className="h-8 w-8 opacity-20 mb-2 text-destructive" />
              <span className="text-sm text-destructive">Failed to load</span>
              <span className="mt-1 text-xs">{error}</span>
            </div>
          ) : !hasData ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground rounded-md border border-dashed border-border bg-muted/20">
              <Activity className="h-8 w-8 opacity-20 mb-2" />
              <span className="text-sm">No data yet</span>
              {emptyHint ? <span className="mt-1 text-xs">{emptyHint}</span> : null}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                {/* Defs for area gradients */}
                <defs>
                  {series.map((s, i) => {
                    const c = s.color || chartColors[i % chartColors.length];
                    return (
                      <linearGradient key={`grad-${s.key}`} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={c} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={c} stopOpacity={0} />
                      </linearGradient>
                    );
                  })}
                </defs>
                
                <CartesianGrid 
                  strokeDasharray="2 4" 
                  vertical={false}
                  stroke="hsl(var(--border))" 
                  strokeOpacity={0.5} 
                />
                
                <XAxis 
                  dataKey="ts" 
                  tickFormatter={formatTime} 
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={30}
                  className="text-[10px] text-muted-foreground font-mono"
                  stroke="hsl(var(--muted-foreground))"
                />
                
                <YAxis 
                  orientation="right"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  className="text-[10px] text-muted-foreground font-mono"
                  stroke="hsl(var(--muted-foreground))"
                  width={40}
                  tickFormatter={(val) => {
                    if (val >= 1000000) return `${(val / 1000000).toFixed(1)}m`;
                    if (val >= 1000) return `${(val / 1000).toFixed(1)}k`;
                    return val;
                  }}
                />
                
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: "hsl(var(--popover))",
                    borderColor: "hsl(var(--border))",
                    borderRadius: "6px",
                    boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
                    color: "hsl(var(--popover-foreground))",
                    fontSize: "12px",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  }}
                  itemStyle={{
                    fontWeight: 500,
                  }}
                  labelStyle={{
                    color: "hsl(var(--muted-foreground))",
                    marginBottom: "4px",
                    fontWeight: 600,
                  }}
                  labelFormatter={(label) => {
                    const d = new Date(label as number);
                    return d.toLocaleString([], { 
                      month: 'short', day: 'numeric', 
                      hour: '2-digit', minute: '2-digit' 
                    });
                  }}
                />
                
                {showLegend && (
                  <Legend 
                    verticalAlign="bottom" 
                    height={36}
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{
                      fontSize: "10px",
                      paddingTop: "12px",
                    }}
                    formatter={(value, entry: any) => (
                      <span className="text-muted-foreground uppercase tracking-wider font-semibold ml-1">
                        {value}
                      </span>
                    )}
                  />
                )}
                
                {series.map((s, i) => {
                  const color = s.color || chartColors[i % chartColors.length];
                  const type = s.type || "line";
                  
                  if (type === "area") {
                    return (
                      <Area
                        key={s.key}
                        name={s.label}
                        type="monotone"
                        dataKey={s.key}
                        stroke={color}
                        strokeWidth={2}
                        fill={`url(#grad-${s.key})`}
                        isAnimationActive={false}
                        dot={false}
                        activeDot={{ r: 4, strokeWidth: 0, fill: color }}
                      />
                    );
                  }
                  
                  if (type === "bar") {
                    return (
                      <Bar
                        key={s.key}
                        name={s.label}
                        dataKey={s.key}
                        fill={color}
                        radius={[2, 2, 0, 0]}
                        isAnimationActive={false}
                      />
                    );
                  }
                  
                  return (
                    <Line
                      key={s.key}
                      name={s.label}
                      type="monotone"
                      dataKey={s.key}
                      stroke={color}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 0, fill: color }}
                      isAnimationActive={false}
                    />
                  );
                })}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
