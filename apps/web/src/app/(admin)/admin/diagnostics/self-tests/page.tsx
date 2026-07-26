"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button, KPIGrid, StatCard, DashboardSection, DataTable, StatusBadge, Badge, type DataTableColumn } from "@satelink/ui";
import { adminGet } from "../../_lib/adminClient";
import { fmtResult } from "../../_lib/format";

interface Metrics {
  cpu_pct: number;
  memory_mb: number;
  uptime_s: number;
  db_status: string;
  redis_status: string;
  api_p50_ms: number;
  requests_24h: number;
}

interface JobRow {
  job_name: string;
  action: string | null;
  result: unknown; // parsed JSON value, not a string
  created_at: string | number | null;
}

interface Check {
  name: string;
  subsystem: string;
  status: "success" | "warning" | "failed";
  value: string;
}

const num = (v: unknown) => Number(v) || 0;

function buildChecks(m: Metrics): Check[] {
  const p50 = num(m.api_p50_ms);
  return [
    { name: "Database connectivity", subsystem: "Postgres", status: m.db_status === "ok" ? "success" : "failed", value: m.db_status },
    {
      name: "Redis connectivity",
      subsystem: "Cache",
      status: m.redis_status === "ok" ? "success" : m.redis_status === "not_configured" ? "warning" : "failed",
      value: m.redis_status,
    },
    { name: "API latency (p50)", subsystem: "Gateway", status: p50 === 0 ? "warning" : p50 < 300 ? "success" : "warning", value: `${p50} ms` },
    { name: "Process memory", subsystem: "Runtime", status: "success", value: `${num(m.memory_mb)} MB` },
    { name: "Uptime", subsystem: "Runtime", status: "success", value: `${Math.floor(num(m.uptime_s) / 3600)}h` },
  ];
}

const cols: DataTableColumn<Check>[] = [
  { key: "name", header: "Check", cell: (r) => <span className="font-medium text-xs text-foreground">{r.name}</span> },
  { key: "subsystem", header: "Subsystem", cell: (r) => <Badge variant="outline">{r.subsystem}</Badge> },
  {
    key: "status",
    header: "Status",
    cell: (r) => <StatusBadge status={r.status === "success" ? "active" : r.status === "warning" ? "pending" : "danger"} label={r.status?.toUpperCase() ?? ''} />,
  },
  { key: "value", header: "Value", align: "right", cell: (r) => <span className="font-mono text-xs text-muted-foreground">{r.value}</span> },
];

export default function AdminSelfTestsPage() {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [reqs24h, setReqs24h] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [m, j] = await Promise.all([adminGet<Metrics>("observability/metrics"), adminGet<{ jobs: JobRow[] }>("jobs/status")]);
    setChecks(m ? buildChecks(m) : []);
    setReqs24h(m ? num(m.requests_24h) : null);
    setJobs(j?.jobs ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const passed = checks?.filter((c) => c.status === "success").length ?? 0;
  const failed = checks?.filter((c) => c.status === "failed").length ?? 0;
  const total = checks?.length ?? 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <KPIGrid columns={4}>
        <StatCard label="Pass Rate" value={total ? `${Math.round((passed / total) * 100)}%` : "—"} caption={`${passed}/${total} checks healthy`} accent={total > 0 && failed === 0} loading={loading} />
        <StatCard label="Failed Checks" value={String(failed)} caption="Critical subsystems down" accent={failed > 0} loading={loading} />
        <StatCard label="Requests (24h)" value={reqs24h != null ? reqs24h.toLocaleString() : "—"} caption="Gateway calls tracked" loading={loading} />
        <StatCard label="Automation Jobs" value={jobs != null ? String(jobs.length) : "—"} caption="Jobs with a logged run" loading={loading} />
      </KPIGrid>

      <DashboardSection
        title="Live Health Checks"
        description="Real subsystem status from /admin/observability/metrics"
        actions={
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Re-check
          </Button>
        }
        flush
      >
        <DataTable columns={cols} rows={checks} rowKey={(r) => r.name} loading={loading} emptyTitle="No metrics" emptyDescription="Could not read server metrics." />
      </DashboardSection>

      <DashboardSection title="Automation Job Runs" description="Latest logged run per job (automation_logs)" flush>
        <DataTable
          columns={[
            { key: "job_name", header: "Job", cell: (r: JobRow) => <span className="font-mono text-xs font-semibold text-foreground">{r.job_name}</span> },
            { key: "action", header: "Action", cell: (r: JobRow) => <Badge variant="outline" className="text-[10px]">{r.action || "—"}</Badge> },
            { key: "result", header: "Result", cell: (r: JobRow) => <span className="font-mono text-[10px] text-muted-foreground truncate max-w-[320px] block">{fmtResult(r.result)}</span> },
          ]}
          rows={jobs}
          rowKey={(r) => r.job_name}
          loading={loading}
          emptyTitle="No job runs"
          emptyDescription="No automation jobs have logged a run."
        />
      </DashboardSection>
    </div>
  );
}
