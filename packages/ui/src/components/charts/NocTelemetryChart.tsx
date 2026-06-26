"use client";
import * as React from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid
} from "recharts";

export interface NocTelemetryPoint {
  time: string;
  value: number;
}

export interface NocTelemetryChartProps {
  data: NocTelemetryPoint[];
  title: string;
  height?: number;
}

export function NocTelemetryChart({
  data,
  title,
  height = 200,
}: NocTelemetryChartProps) {
  return (
    <div className="flex flex-col border border-border bg-card rounded-md h-full">
      <div className="px-3 py-2 border-b border-border bg-muted/30">
        <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
          {title}
        </span>
      </div>
      <div className="flex-1 p-2">
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={data} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#00ADB5" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#00ADB5" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#393E46" vertical={false} />
            <XAxis 
              dataKey="time" 
              tick={{ fill: "#93B1A6", fontSize: 10 }} 
              tickLine={false}
              axisLine={{ stroke: "#393E46" }}
              minTickGap={20}
            />
            <YAxis 
              tick={{ fill: "#93B1A6", fontSize: 10 }} 
              tickLine={false} 
              axisLine={false}
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: "#040D12", 
                borderColor: "#393E46",
                fontSize: "12px",
                color: "#EEEEEE"
              }}
              itemStyle={{ color: "#00ADB5" }}
            />
            <Area 
              type="monotone" 
              dataKey="value" 
              stroke="#00ADB5" 
              strokeWidth={2}
              fillOpacity={1} 
              fill="url(#colorValue)" 
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
