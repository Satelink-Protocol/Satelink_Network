"use client";

import { useState } from "react";
import { Plus, LayoutGrid, Key, Activity, CreditCard, ChevronRight } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  KPIGrid,
  StatCard,
  DataTable,
  StatusBadge,
  Badge,
} from "@satelink/ui";

interface ProjectRow {
  id: string;
  name: string;
  keysCount: number;
  requests24h: number;
  spendUsdt: number;
  status: "active" | "inactive";
  created: string;
}

const INITIAL_PROJECTS: ProjectRow[] = [
  { id: "PRJ-001", name: "Production App gateway", keysCount: 2, requests24h: 128450, spendUsdt: 3.8535, status: "active", created: "Jun 12, 2026" },
  { id: "PRJ-002", name: "Staging sandbox", keysCount: 1, requests24h: 4210, spendUsdt: 0.1263, status: "active", created: "Jun 15, 2026" },
  { id: "PRJ-003", name: "Hackathon indexer", keysCount: 1, requests24h: 0, spendUsdt: 0.0, status: "inactive", created: "Jun 24, 2026" },
];

export default function BuilderProjectsPage() {
  const [projects] = useState<ProjectRow[]>(INITIAL_PROJECTS);

  const cols = [
    {
      key: "name",
      header: "Project Name",
      cell: (r: ProjectRow) => (
        <div className="flex items-center gap-2">
          <LayoutGrid className="h-4 w-4 text-muted-foreground" />
          <span className="font-semibold text-xs text-foreground">{r.name}</span>
        </div>
      ),
    },
    {
      key: "keysCount",
      header: "Authorized Keys",
      cell: (r: ProjectRow) => (
        <span className="font-mono text-xs text-zinc-400">{r.keysCount} keys</span>
      ),
    },
    {
      key: "requests24h",
      header: "Requests (24h)",
      align: "right" as const,
      cell: (r: ProjectRow) => <span className="font-mono text-xs text-foreground">{r.requests24h.toLocaleString()}</span>,
    },
    {
      key: "spendUsdt",
      header: "USDT Spend (24h)",
      align: "right" as const,
      cell: (r: ProjectRow) => <span className="font-mono text-xs text-emerald-400">${r.spendUsdt.toFixed(4)}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (r: ProjectRow) => (
        <StatusBadge status={r.status === "active" ? "active" : "neutral"} label={r.status?.toUpperCase() ?? ''} />
      ),
    },
    {
      key: "created",
      header: "Created",
      cell: (r: ProjectRow) => <span className="text-xs text-muted-foreground">{r.created}</span>,
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in max-w-6xl mx-auto py-6 px-4">
      <DashboardSection title="Projects Directory" description="Authorized development environments" flush>
        <DataTable columns={cols} rows={projects} rowKey={(r) => r.id} />
      </DashboardSection>
    </div>
  );
}
