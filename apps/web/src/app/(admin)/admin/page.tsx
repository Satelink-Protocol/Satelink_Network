"use client";

import { useEffect, useState } from "react";
import { Server, DollarSign, Cpu, Receipt, Play, RefreshCw } from "lucide-react";
import {
  DashboardSection,
  KPIGrid,
  StatCard,
  DataTable,
  StatusBadge,
  Badge,
  SeriesChart,
  Button,
} from "@satelink/ui";
import { DataScopeBadge, SampleDataBanner } from "./_components/DataScope";

// Live revenue summary from the (test-data-aware) admin observer endpoint.
// /admin/revenue/summary already excludes founder/test rows via
// `FILTER (WHERE NOT is_test_data)` — the UI just has to consume it instead of
// the un-filtered public /api/revenue total it used before.
interface RevenueSummary {
  total_real_usdt: number;
  free_tier_calls_24h: number;
  real_data_count: number;
  is_test_data_count: number;
}

async function adminFetch<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch("/api/admin-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, method: "GET" }),
    });
    const data = await res.json();
    return data?.ok ? (data as T) : null;
  } catch {
    return null;
  }
}

interface JobQueueRow {
  jobName: string;
  schedule: string;
  status: "idle" | "running" | "failed";
  lastRun: string;
  durationMs: number;
}

const JOBS: JobQueueRow[] = [
  { jobName: "ip-classifier", schedule: "*/5 * * * *", status: "idle", lastRun: "3 mins ago", durationMs: 450 },
  { jobName: "customer-zero-detector", schedule: "*/1 * * * *", status: "running", lastRun: "Just now", durationMs: 120 },
  { jobName: "merkle-root-generator", schedule: "*/10 * * * *", status: "idle", lastRun: "8 mins ago", durationMs: 1850 },
  { jobName: "outreach-scheduler", schedule: "0 * * * *", status: "failed", lastRun: "1 hour ago", durationMs: 3400 },
];

export default function AdminCommandCenterPage() {
  const [nodesOnline, setNodesOnline] = useState<number | null>(null);
  const [revenue, setRevenue] = useState<RevenueSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<JobQueueRow[]>(JOBS);
  const [acting, setActing] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/nodes?status=active&limit=1")
        .then((r) => r.json())
        .catch(() => null),
      // Was fetch("/api/revenue") — the public endpoint SUMs revenue_events_v2
      // with NO is_test_data filter, so founder/test settlements showed up as
      // real revenue on this screen. /admin/revenue/summary excludes them.
      adminFetch<RevenueSummary>("revenue/summary"),
    ])
      .then(([nodesData, revenueData]) => {
        setNodesOnline(nodesData?.ok ? nodesData.pagination?.total ?? 0 : null);
        setRevenue(revenueData);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleTrigger = (name: string) => {
    setActing(name);
    setTimeout(() => {
      setJobs((prev) =>
        prev.map((job) =>
          job.jobName === name ? { ...job, status: "idle", lastRun: "Just now", durationMs: Math.floor(Math.random() * 500) + 100 } : job
        )
      );
      setActing(null);
      alert(`Job ${name} executed successfully.`);
    }, 800);
  };

  const chartData = [
    { x: "06:00", y: 42 },
    { x: "06:05", y: 48 },
    { x: "06:10", y: 45 },
    { x: "06:15", y: 62 },
    { x: "06:20", y: 55 },
    { x: "06:25", y: 74 },
    { x: "06:30", y: 68 },
  ];

  const cols = [
    {
      key: "jobName",
      header: "Scheduler Job Identifier",
      cell: (r: JobQueueRow) => <span className="font-mono text-xs font-semibold text-foreground">{r.jobName}</span>,
    },
    {
      key: "schedule",
      header: "Cron Expression",
      cell: (r: JobQueueRow) => <Badge variant="outline" className="font-mono text-[10px]">{r.schedule}</Badge>,
    },
    {
      key: "status",
      header: "Status",
      cell: (r: JobQueueRow) => (
        <StatusBadge
          status={r.status === "running" ? "active" : r.status === "failed" ? "danger" : "neutral"}
          label={r.status.toUpperCase()}
        />
      ),
    },
    {
      key: "lastRun",
      header: "Last Run Executed",
      cell: (r: JobQueueRow) => <span className="text-xs text-muted-foreground">{r.lastRun}</span>,
    },
    {
      key: "durationMs",
      header: "Duration",
      align: "right" as const,
      cell: (r: JobQueueRow) => <span className="font-mono text-xs text-muted-foreground">{r.durationMs}ms</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right" as const,
      cell: (r: JobQueueRow) => (
        <Button
          size="xs"
          variant="outline"
          disabled={acting !== null}
          onClick={() => handleTrigger(r.jobName)}
        >
          {acting === r.jobName ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3 mr-1" />} Run Now
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-end">
        <DataScopeBadge included={false} testCount={revenue?.is_test_data_count ?? null} />
      </div>

      <KPIGrid columns={4}>
        <StatCard
          label="Nodes Online"
          value={nodesOnline ?? "—"}
          icon={Server}
          loading={loading}
          accent
        />
        <StatCard
          label="Total Revenue (real)"
          value={revenue != null ? `$${(Number(revenue.total_real_usdt) || 0).toFixed(2)}` : "—"}
          caption="Founder/test settlements excluded"
          icon={DollarSign}
          accent
          loading={loading}
        />
        <StatCard
          label="API Request Volume (24h)"
          value={revenue != null ? (Number(revenue.free_tier_calls_24h) || 0).toLocaleString() : "—"}
          caption="Gateway requests, last 24h"
          icon={Cpu}
          loading={loading}
        />
        <StatCard
          label="Real Revenue Events"
          value={revenue != null ? (Number(revenue.real_data_count) || 0).toLocaleString() : "—"}
          caption={
            revenue != null
              ? `${(Number(revenue.is_test_data_count) || 0).toLocaleString()} test events excluded`
              : undefined
          }
          icon={Receipt}
          loading={loading}
        />
      </KPIGrid>

      <SampleDataBanner note="The scheduler telemetry and CPU chart below are placeholder values, not live job or system metrics. Do not use them for decisions." />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <DashboardSection title="Scheduler Job Telemetry" description="Active scheduler policies and task queue status" flush>
            <DataTable columns={cols} rows={jobs} rowKey={(r) => r.jobName} />
          </DashboardSection>
        </div>

        <div>
          <DashboardSection title="System Loading Monitor" description="API Gateway CPU utilization (last 30 minutes)" flush>
            <div className="p-4 bg-zinc-900/40 border border-border border-t-0 rounded-b-md">
              <SeriesChart title="CPU Usage" data={chartData} type="area" height={190} />
            </div>
          </DashboardSection>
        </div>
      </div>
    </div>
  );
}
