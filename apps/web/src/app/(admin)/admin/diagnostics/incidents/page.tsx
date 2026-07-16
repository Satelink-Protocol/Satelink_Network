"use client";

import { useEffect, useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle } from "lucide-react";
import { KPIGrid, StatCard, DashboardSection, DataTable, StatusBadge, Badge, type DataTableColumn } from "@satelink/ui";
import { adminGet } from "../../_lib/adminClient";

interface Incident {
  id: string;
  severity: "critical" | "high" | "major" | "minor" | string;
  title: string;
  status: "unassigned" | "acknowledged" | "resolved" | string;
  owner?: string | null;
  resolved_at?: string | null;
  note?: string | null;
}

const severityTone = (sev: string) =>
  ({
    critical: "bg-red-500/15 text-red-400 border-red-500/30",
    high: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    major: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    minor: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  }[sev] ?? "bg-zinc-800 text-zinc-400 border-zinc-700");

const cols: DataTableColumn<Incident>[] = [
  { key: "id", header: "ID", cell: (r) => <span className="font-mono text-xs font-semibold text-foreground">{r.id}</span> },
  {
    key: "title",
    header: "Title",
    cell: (r) => (
      <div className="flex flex-col gap-0.5">
        <span className="font-medium text-xs text-foreground">{r.title}</span>
        {r.note ? <span className="text-[10px] text-muted-foreground">{r.note}</span> : null}
      </div>
    ),
  },
  { key: "severity", header: "Severity", cell: (r) => <Badge className={severityTone(r.severity) + " text-[10px] uppercase font-mono"}>{r.severity}</Badge> },
  {
    key: "status",
    header: "Status",
    cell: (r) => <StatusBadge status={r.status === "resolved" ? "active" : r.status === "acknowledged" ? "pending" : "neutral"} label={String(r.status).toUpperCase()} />,
  },
  { key: "owner", header: "Owner", cell: (r) => <span className="text-xs text-muted-foreground">{r.owner || "—"}</span> },
];

export default function AdminIncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminGet<{ incidents: Incident[]; source?: string }>("incidents")
      .then((d) => {
        setIncidents(d?.incidents ?? []);
        setSource(d?.source ?? null);
      })
      .finally(() => setLoading(false));
  }, []);

  const active = incidents?.filter((i) => i.status !== "resolved").length ?? 0;
  const critical = incidents?.filter((i) => i.severity === "critical" && i.status !== "resolved").length ?? 0;
  const resolved = incidents?.filter((i) => i.status === "resolved").length ?? 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <KPIGrid columns={3}>
        <StatCard label="Active Incidents" value={String(active)} caption="Not yet resolved" accent={active > 0} icon={AlertCircle} loading={loading} />
        <StatCard label="Unresolved Critical" value={String(critical)} caption="Severe, still open" icon={AlertTriangle} loading={loading} />
        <StatCard label="Resolved" value={String(resolved)} caption="Closed incidents" icon={CheckCircle} loading={loading} />
      </KPIGrid>

      <DashboardSection
        title="Incidents"
        description={source ?? "Incident record"}
        flush
      >
        <DataTable
          columns={cols}
          rows={incidents}
          rowKey={(r) => r.id}
          loading={loading}
          emptyTitle="No incidents"
          emptyDescription="No incidents on record."
        />
      </DashboardSection>
    </div>
  );
}
