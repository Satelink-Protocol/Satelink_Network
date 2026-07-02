"use client";

import { useState } from "react";
import { CircleDollarSign, CalendarDays, TrendingUp, HelpCircle } from "lucide-react";
import {
  Button,
  KPIStat,
  DashboardSection,
  DataTable,
  StatusBadge,
  Badge,
  SeriesChart,
} from "@satelink/ui";

interface CustomerCohort {
  apiKey: string;
  name: string;
  totalCalls: number;
  billedUsdt: number;
  marginPercent: number;
  avgLatencyMs: number;
}

export default function AdminRevenuePage() {
  const [cohorts] = useState<CustomerCohort[]>([]);
  const chartData: any[] = [];

  const cols = [
    {
      key: "name",
      header: "Billing Group Label",
      cell: (r: CustomerCohort) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold text-xs text-foreground">{r.name}</span>
          <span className="text-[10px] text-muted-foreground font-mono">Key: {r.apiKey}</span>
        </div>
      ),
    },
    {
      key: "totalCalls",
      header: "Cumulative Requests",
      align: "right" as const,
      cell: (r: CustomerCohort) => <span className="text-xs text-foreground font-mono">{r.totalCalls.toLocaleString()} calls</span>,
    },
    {
      key: "billedUsdt",
      header: "USDT Billed",
      align: "right" as const,
      cell: (r: CustomerCohort) => <span className="font-mono text-xs text-emerald-400 font-semibold">${r.billedUsdt.toFixed(4)} USDT</span>,
    },
    {
      key: "avgLatencyMs",
      header: "Avg Latency",
      align: "right" as const,
      cell: (r: CustomerCohort) => <span className="font-mono text-xs text-muted-foreground">{r.avgLatencyMs}ms</span>,
    },
    {
      key: "marginPercent",
      header: "Net Profit Margin",
      align: "right" as const,
      cell: (r: CustomerCohort) => (
        <Badge variant="outline" className="text-[11px] font-mono">
          {r.marginPercent}%
        </Badge>
      ),
    },
  ];

  return (
    <div className="px-6 py-6">
      <div className="grid grid-cols-12 gap-4 mb-4">
        {/* ROW 1 — KPI strip */}
        <div className="col-span-12 md:col-span-4">
          <KPIStat
            label="Cumulative Billed Revenue"
            value={null}
            caption="Total billed across all api keys"
            icon={CircleDollarSign}
          />
        </div>
        <div className="col-span-12 md:col-span-4">
          <KPIStat
            label="Average Margin"
            value={null}
            caption="Margins factoring validator gas overhead"
            icon={TrendingUp}
          />
        </div>
        <div className="col-span-12 md:col-span-4">
          <KPIStat
            label="Today's Revenue Runrate"
            value={null}
            caption="Daily growth trajectory rate"
            icon={CalendarDays}
          />
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4 mb-6">
        {/* ROW 2 — Core Operations */}
        <div className="col-span-12 lg:col-span-9 flex flex-col">
          <div className="bg-zinc-900 border border-zinc-800 rounded-sm p-5 h-full min-h-[350px]">
            <div className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-4 border-b border-zinc-800 pb-2">Daily Billing Revenue Timeline</div>
            <SeriesChart label="USDT Spent" data={chartData} type="area" height={260} />
          </div>
        </div>

        <div className="col-span-12 lg:col-span-3 flex flex-col gap-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-sm p-5 h-full">
            <div className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-4 border-b border-zinc-800 pb-2">Overhead</div>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-400">Gas Expense (POL)</span>
                <span className="font-mono text-sm font-medium text-zinc-300">—</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-400">Network Fees</span>
                <span className="font-mono text-sm font-medium text-zinc-300">—</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4 mb-6">
        {/* ROW 3 — Data Tables */}
        <div className="col-span-12">
          <div className="bg-zinc-900 border border-zinc-800 rounded-sm p-5">
            <div className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-4 border-b border-zinc-800 pb-2">Tenants Consumption Summary</div>
            <DataTable columns={cols} rows={cohorts} rowKey={(r) => r.apiKey} emptyTitle="No data yet" />
          </div>
        </div>
      </div>
    </div>
  );
}
