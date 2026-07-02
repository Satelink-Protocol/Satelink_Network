"use client";

import { useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle, Info, RefreshCw, Send } from "lucide-react";
import {
  Button,
  KPIGrid,
  StatCard,
  DashboardSection,
  DataTable,
  StatusBadge,
  Badge,
} from "@satelink/ui";

interface Incident {
  id: string;
  title: string;
  service: string;
  severity: "critical" | "major" | "minor";
  status: "unassigned" | "acknowledged" | "resolved";
  timestamp: string;
  duration: string;
}

const INITIAL_INCIDENTS: Incident[] = [
  { id: "INC-901", title: "RPC Rate Limit Loop Hole Detected", service: "rpc-gateway", severity: "critical", status: "unassigned", timestamp: "10 mins ago", duration: "10m" },
  { id: "INC-889", title: "Redis memory utilization > 85%", service: "cache-store", severity: "major", status: "acknowledged", timestamp: "1 hour ago", duration: "1h 4m" },
  { id: "INC-884", title: "EVM Signer Gas Balance Warning", service: "reputation-engine", severity: "minor", status: "acknowledged", timestamp: "3 hours ago", duration: "3h 12m" },
  { id: "INC-852", title: "Database Write Queue Backlog", service: "db-writer", severity: "major", status: "resolved", timestamp: "1 day ago", duration: "45m" },
  { id: "INC-841", title: "Free Tier IP Blacklist Sync Failure", service: "rate-limiter", severity: "critical", status: "resolved", timestamp: "2 days ago", duration: "2h 10m" },
];

export default function AdminIncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>(INITIAL_INCIDENTS);
  const [loading, setLoading] = useState(false);

  const handleAction = (id: string, nextStatus: Incident["status"]) => {
    setLoading(true);
    setTimeout(() => {
      setIncidents((prev) =>
        prev.map((inc) => (inc.id === id ? { ...inc, status: nextStatus } : inc))
      );
      setLoading(false);
    }, 400);
  };

  const severityTone = (sev: Incident["severity"]) => {
    return {
      critical: "bg-red-500/15 text-red-400 border-red-500/30",
      major: "bg-orange-500/15 text-orange-400 border-orange-500/30",
      minor: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    }[sev];
  };

  const cols = [
    {
      key: "id",
      header: "Incident ID",
      cell: (r: Incident) => <span className="font-mono text-xs font-semibold text-foreground">{r.id}</span>,
    },
    {
      key: "title",
      header: "Alert Title",
      cell: (r: Incident) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-xs text-foreground">{r.title}</span>
          <span className="text-[10px] text-muted-foreground">Service: {r.service}</span>
        </div>
      ),
    },
    {
      key: "severity",
      header: "Severity",
      cell: (r: Incident) => (
        <Badge className={severityTone(r.severity) + " text-[10px] uppercase font-mono"}>
          {r.severity}
        </Badge>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (r: Incident) => (
        <StatusBadge
          status={r.status === "unassigned" ? "neutral" : r.status === "acknowledged" ? "pending" : "active"}
          label={r.status.toUpperCase()}
        />
      ),
    },
    {
      key: "timestamp",
      header: "Triggered",
      cell: (r: Incident) => <span className="text-xs text-muted-foreground">{r.timestamp}</span>,
    },
    {
      key: "duration",
      header: "Duration",
      cell: (r: Incident) => <span className="text-xs text-muted-foreground font-mono">{r.duration}</span>,
    },
    {
      key: "actions",
      header: "Operator Action",
      align: "right" as const,
      cell: (r: Incident) => (
        <div className="flex items-center gap-1.5 justify-end">
          {r.status === "unassigned" && (
            <Button
              size="xs"
              variant="outline"
              disabled={loading}
              onClick={() => handleAction(r.id, "acknowledged")}
            >
              Acknowledge
            </Button>
          )}
          {r.status === "acknowledged" && (
            <Button
              size="xs"
              variant="default"
              disabled={loading}
              onClick={() => handleAction(r.id, "resolved")}
            >
              Resolve
            </Button>
          )}
          {r.status !== "resolved" && (
            <Button
              size="xs"
              variant="ghost"
              disabled={loading}
              onClick={() => {
                alert(`Paging the on-call engineer for ${r.id}...`);
              }}
              className="text-red-400 hover:text-red-500 hover:bg-red-500/10"
            >
              <Send className="h-3 w-3 mr-1" /> Page
            </Button>
          )}
          {r.status === "resolved" && (
            <span className="text-[11px] text-emerald-400 font-medium">✓ Closed</span>
          )}
        </div>
      ),
    },
  ];

  const activeCount = incidents.filter((i) => i.status !== "resolved").length;
  const criticalCount = incidents.filter((i) => i.severity === "critical" && i.status !== "resolved").length;
  const acknowledgedCount = incidents.filter((i) => i.status === "acknowledged").length;

  return (
    <div className="space-y-6 animate-fade-in">
      <KPIGrid columns={3}>
        <StatCard
          label="Active Incidents"
          value={String(activeCount)}
          caption="Requires operator attention"
          accent={activeCount > 0}
          icon={AlertCircle}
        />
        <StatCard
          label="Unresolved Critical"
          value={String(criticalCount)}
          caption="Severe network disruptions"
          trend={{ label: criticalCount > 0 ? "high risk" : "stable", direction: criticalCount > 0 ? "down" : "neutral" }}
          icon={AlertTriangle}
        />
        <StatCard
          label="Acknowledged Issues"
          value={String(acknowledgedCount)}
          caption="Currently under investigation"
          icon={CheckCircle}
        />
      </KPIGrid>

      <DashboardSection
        label="Incident Dashboard"
        description="Real-time incident response management center"
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" asChild>
              <a href="/satelink/os/monitoring">Open Monitoring Logs</a>
            </Button>
          </div>
        }
        flush
      >
        <DataTable columns={cols} rows={incidents} rowKey={(r) => r.id} />
      </DashboardSection>
    </div>
  );
}
