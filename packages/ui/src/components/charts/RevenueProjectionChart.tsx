"use client";
import React from 'react';
import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, Tooltip } from 'recharts';

export interface RevenueProjectionData {
  label: string;
  daily: number;
  monthly: number;
}

export interface RevenueProjectionChartProps {
  data: RevenueProjectionData[];
}

export function RevenueProjectionChart({ data }: RevenueProjectionChartProps): JSX.Element {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} barCategoryGap="30%" margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <XAxis
          dataKey="label"
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11, fontFamily: "ui-monospace, monospace" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11, fontFamily: "ui-monospace, monospace" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `$${v}`}
        />
        <Tooltip
          contentStyle={{
            background: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 4,
            fontFamily: "ui-monospace, monospace",
            fontSize: 12,
            color: "hsl(var(--foreground))",
          }}
          formatter={(value) => [`$${value}/mo`, "Monthly"]}
          labelStyle={{ color: "hsl(var(--muted-foreground))" }}
          cursor={{ fill: "hsl(var(--primary) / 0.05)" }}
        />
        <Bar dataKey="monthly" radius={[4, 4, 0, 0]}>
          <Cell fill="hsl(var(--primary))" />
          <Cell fill="hsl(var(--primary) / 0.7)" />
          <Cell fill="hsl(var(--primary) / 0.5)" />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
