"use client";

import { useState } from "react";
import { CircleDollarSign, CalendarDays, TrendingUp, HelpCircle } from "lucide-react";
import {
  Button,
  KPIGrid,
  StatCard,
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

const COHORTS: CustomerCohort[] = [
  { apiKey: "sk_live_f89c...", name: "Polygon Indexer Ingress", totalCalls: 1849102, billedUsdt: 55.4730, marginPercent: 94.2, avgLatencyMs: 42 },
  { apiKey: "sk_live_9a22...", name: "MEV Searcher Bot 01", totalCalls: 981244, billedUsdt: 29.4373, marginPercent: 88.6, avgLatencyMs: 38 },
  { apiKey: "sk_live_1bc8...", name: "Local Dev Test Key", totalCalls: 12450, billedUsdt: 0.3735, marginPercent: 98.1, avgLatencyMs: 82 },
  { apiKey: "sk_live_44aa...", name: "Public Dapp Endpoint", totalCalls: 4501, billedUsdt: 0.1350, marginPercent: 91.4, avgLatencyMs: 45 },
];

export default function AdminRevenuePage() {
  const [cohorts] = useState<CustomerCohort[]>(COHORTS);

  const chartData = [
    { x: "06-19", y: 12.45 },
    { x: "06-20", y: 15.62 },
    { x: "06-21", y: 18.91 },
    { x: "06-22", y: 22.45 },
    { x: "06-23", y: 24.12 },
    { x: "06-24", y: 28.56 },
    { x: "06-25", y: 32.41 },
  ];

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
        <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[11px] font-mono">
          {r.marginPercent}%
        </Badge>
      ),
    },
  ];

  const totalBilled = cohorts.reduce((sum, c) => sum + c.billedUsdt, 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <KPIGrid columns={4}>
        <StatCard
          label="Cumulative Billed Revenue"
          value={`$${totalBilled.toFixed(4)} USDT`}
          caption="Total billed across all api keys"
          icon={CircleDollarSign}
          accent
        />
        <StatCard
          label="Average Margin"
          value="93.1%"
          caption="Margins factoring validator gas overhead"
          icon={TrendingUp}
          accent
        />
        <StatCard
          label="Today's Revenue Runrate"
          value="$32.41 USDT"
          caption="Daily growth trajectory rate"
          icon={CalendarDays}
          trend={{ label: "+14.2% daily", direction: "up" }}
        />
        <StatCard
          label="Gas Expense (POL)"
          value="0.065 POL"
          caption="Accrued payout transaction fees"
        />
      </KPIGrid>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <DashboardSection title="Tenants Consumption Summary" description="Core billing breakdown per API key cohort" flush>
            <DataTable columns={cols} rows={cohorts} rowKey={(r) => r.apiKey} />
          </DashboardSection>
        </div>

        <div>
          <DashboardSection title="Daily Billing Revenue Timeline" description="Metered USDT credit consumption history" flush>
            <div className="p-4 bg-zinc-900/40 border border-border border-t-0 rounded-b-md">
              <SeriesChart title="USDT Spent" data={chartData} type="area" height={200} />
            </div>
          </DashboardSection>
        </div>
      </div>
    </div>
  );
}
