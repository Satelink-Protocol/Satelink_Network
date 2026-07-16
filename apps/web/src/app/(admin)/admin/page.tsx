"use client";

import { useEffect, useState } from "react";
import { Server, DollarSign, Cpu, Receipt, Database, Activity } from "lucide-react";
import {
  DashboardSection,
  KPIGrid,
  StatCard,
  DataTable,
  Badge,
} from "@satelink/ui";
import { DataScopeBadge } from "./_components/DataScope";
import { adminGet } from "./_lib/adminClient";

// /admin/revenue/summary already excludes founder/test rows via
// FILTER (WHERE NOT is_test_data) — the UI consumes it instead of the
// un-filtered public /api/revenue total.
interface RevenueSummary {
  total_real_usdt: number;
  free_tier_calls_24h: number;
  real_data_count: number;
  is_test_data_count: number;
}

// /admin/jobs/status → DISTINCT ON (job_name) latest automation_logs row.
interface JobRow {
  job_name: string;
  action: string | null;
  result: string | null;
  created_at: string | number | null;
}

// /admin/observability/metrics — server-internal health snapshot.
interface Metrics {
  cpu_pct: number;
  memory_mb: number;
  uptime_s: number;
  db_status: string;
  redis_status: string;
  api_p50_ms: number;
  requests_24h: number;
}

function timeAgo(ts: string | number | null): string {
  if (ts == null) return "—";
  const n = Number(ts);
  const ms = Number.isFinite(n) ? (n > 1e12 ? n : n * 1000) : Date.parse(String(ts));
  if (!Number.isFinite(ms)) return "—";
  const diff = Date.now() - ms;
  if (diff < 0) return "just now";
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function AdminCommandCenterPage() {
  const [nodesOnline, setNodesOnline] = useState<number | null>(null);
  const [revenue, setRevenue] = useState<RevenueSummary | null>(null);
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/nodes?status=active&limit=1")
        .then((r) => r.json())
        .catch(() => null),
      adminGet<RevenueSummary>("revenue/summary"),
      adminGet<{ jobs: JobRow[] }>("jobs/status"),
      adminGet<Metrics>("observability/metrics"),
    ])
      .then(([nodesData, revenueData, jobsData, metricsData]) => {
        setNodesOnline(nodesData?.ok ? nodesData.pagination?.total ?? 0 : null);
        setRevenue(revenueData);
        setJobs(jobsData?.jobs ?? []);
        setMetrics(metricsData);
      })
      .finally(() => setLoading(false));
  }, []);

  const jobCols = [
    {
      key: "job_name",
      header: "Scheduler Job",
      cell: (r: JobRow) => <span className="font-mono text-xs font-semibold text-foreground">{r.job_name}</span>,
    },
    {
      key: "action",
      header: "Last Action",
      cell: (r: JobRow) => <Badge variant="outline" className="font-mono text-[10px]">{r.action || "—"}</Badge>,
    },
    {
      key: "created_at",
      header: "Last Run",
      cell: (r: JobRow) => <span className="text-xs text-muted-foreground">{timeAgo(r.created_at)}</span>,
    },
    {
      key: "result",
      header: "Result",
      cell: (r: JobRow) => (
        <span className="font-mono text-[10px] text-muted-foreground truncate max-w-[260px] block">
          {r.result ?? "—"}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-end">
        <DataScopeBadge included={false} testCount={revenue?.is_test_data_count ?? null} />
      </div>

      <KPIGrid columns={4}>
        <StatCard label="Nodes Online" value={nodesOnline ?? "—"} icon={Server} loading={loading} accent />
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
          caption={revenue != null ? `${(Number(revenue.is_test_data_count) || 0).toLocaleString()} test events excluded` : undefined}
          icon={Receipt}
          loading={loading}
        />
      </KPIGrid>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <DashboardSection title="Scheduler Jobs" description="Latest run per automation job (from automation_logs)" flush>
            <DataTable
              columns={jobCols}
              rows={jobs}
              rowKey={(r) => r.job_name}
              loading={loading}
              emptyTitle="No job runs recorded"
              emptyDescription="No automation jobs have logged a run yet."
            />
          </DashboardSection>
        </div>

        <div>
          <DashboardSection title="System Health" description="Server-internal metrics (live)" flush>
            <div className="p-4 bg-zinc-900/40 border border-border border-t-0 rounded-b-md space-y-3">
              <HealthRow icon={Database} label="Database" value={metrics?.db_status ?? "—"} good={metrics?.db_status === "ok"} />
              <HealthRow icon={Database} label="Redis" value={metrics?.redis_status ?? "—"} good={metrics?.redis_status === "ok"} />
              <HealthRow icon={Activity} label="API p50" value={metrics ? `${metrics.api_p50_ms} ms` : "—"} />
              <HealthRow icon={Cpu} label="Memory" value={metrics ? `${metrics.memory_mb} MB` : "—"} />
              <HealthRow icon={Activity} label="Uptime" value={metrics ? `${Math.floor(metrics.uptime_s / 3600)}h` : "—"} />
            </div>
          </DashboardSection>
        </div>
      </div>
    </div>
  );
}

function HealthRow({
  icon: Icon,
  label,
  value,
  good,
}: {
  icon: typeof Database;
  label: string;
  value: string;
  good?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </span>
      <span className={good === undefined ? "font-mono text-foreground" : good ? "font-mono text-emerald-400" : "font-mono text-red-400"}>
        {value}
      </span>
    </div>
  );
}
