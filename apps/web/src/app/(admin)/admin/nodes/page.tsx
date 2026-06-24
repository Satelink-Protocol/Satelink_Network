"use client";

import { useEffect, useState } from "react";
import { Badge, DataTable, type DataTableColumn } from "@satelink/ui";

interface NodeRow {
  nodeId: string;
  nodeType: string;
  region: string;
  status: string;
  tier: string;
  reputationScore: number;
  uptimePct: number;
  registeredAt: number;
}

const STATUS_TONE: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  pending: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  offline: "bg-zinc-800 text-zinc-400 border-zinc-700",
  suspended: "bg-red-500/15 text-red-400 border-red-500/30",
  inactive: "bg-zinc-800 text-zinc-400 border-zinc-700",
};

const columns: DataTableColumn<NodeRow>[] = [
  { key: "nodeId", header: "Node ID", cell: (r) => <span className="font-mono text-xs">{r.nodeId}</span> },
  { key: "nodeType", header: "Type", cell: (r) => r.nodeType },
  { key: "region", header: "Region", cell: (r) => r.region },
  {
    key: "status",
    header: "Status",
    cell: (r) => (
      <Badge className={STATUS_TONE[r.status] ?? "bg-zinc-800 text-zinc-400 border-zinc-700"}>
        {r.status}
      </Badge>
    ),
  },
  { key: "tier", header: "Tier", cell: (r) => r.tier },
  { key: "uptimePct", header: "Uptime", cell: (r) => `${r.uptimePct?.toFixed?.(2) ?? r.uptimePct}%`, align: "right" },
  {
    key: "registeredAt",
    header: "Registered",
    cell: (r) => (r.registeredAt ? new Date(r.registeredAt * 1000).toLocaleDateString() : "—"),
    align: "right",
  },
];

export default function AdminNodesPage() {
  const [nodes, setNodes] = useState<NodeRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/nodes?limit=100")
      .then((r) => r.json())
      .then((data) => setNodes(data?.ok ? data.nodes : []))
      .catch(() => setNodes([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <DataTable
      columns={columns}
      rows={nodes}
      rowKey={(r) => r.nodeId}
      loading={loading}
      emptyTitle="No nodes registered"
      emptyDescription="No network nodes have registered with the node registry yet."
    />
  );
}
