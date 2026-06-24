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
          tick={{ fill: "#64748B", fontSize: 11, fontFamily: "JetBrains Mono" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: "#64748B", fontSize: 11, fontFamily: "JetBrains Mono" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `$${v}`}
        />
        <Tooltip
          contentStyle={{
            background: "#0C1120",
            border: "1px solid #1A2840",
            borderRadius: 4,
            fontFamily: "JetBrains Mono",
            fontSize: 12,
          }}
          formatter={(value) => [`$${value}/mo`, "Monthly"]}
          labelStyle={{ color: "#64748B" }}
          cursor={{ fill: "rgba(78,205,196,0.05)" }}
        />
        <Bar dataKey="monthly" radius={[4, 4, 0, 0]}>
          <Cell fill="#4ECDC4" />
          <Cell fill="#4ECDC4" opacity={0.7} />
          <Cell fill="#4ECDC4" opacity={0.5} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
