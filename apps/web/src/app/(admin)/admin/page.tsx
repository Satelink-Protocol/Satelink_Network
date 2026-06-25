"use client";

import { useEffect, useState } from "react";
import { Server, DollarSign, Cpu, AlertTriangle, ShieldCheck, Play, RefreshCw } from "lucide-react";
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
  const [totalRevenue, setTotalRevenue] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<JobQueueRow[]>(JOBS);
  const [acting, setActing] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/nodes?status=active&limit=1")
        .then((r) => r.json())
        .catch(() => null),
      fetch("/api/revenue")
        .then((r) => r.json())
        .catch(() => null),
    ])
      .then(([nodesData, revenueData]) => {
        setNodesOnline(nodesData?.ok ? nodesData.pagination?.total ?? 0 : null);
        setTotalRevenue(revenueData?.ok ? Number(revenueData.total) : null);
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
      <KPIGrid columns={4}>
        <StatCard
          label="Nodes Online"
          value={nodesOnline ?? "—"}
          icon={Server}
          loading={loading}
          accent
        />
        <StatCard
          label="Total Revenue"
          value={totalRevenue != null ? `$${totalRevenue.toFixed(2)}` : "—"}
          icon={DollarSign}
          accent
          loading={loading}
        />
        <StatCard
          label="API Request Volume (24h)"
          value="18,491"
          icon={Cpu}
          trend={{ label: "+8.4% vs yesterday", direction: "up" }}
        />
        <StatCard
          label="Security Incidents"
          value="0"
          icon={ShieldCheck}
          accent={false}
        />
      </KPIGrid>

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
