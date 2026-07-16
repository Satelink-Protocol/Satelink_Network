"use client";

import { useEffect, useState } from "react";
import { Trophy, Compass, Layers } from "lucide-react";
import { KPIGrid, StatCard, DashboardSection, DataTable, StatusBadge, type DataTableColumn } from "@satelink/ui";

interface EpochRow {
  epoch_id: number;
  status: string;
  starts_at: string | number | null;
  ends_at: string | number | null;
  total: number | string | null;
  node_pool_usdt: number | string | null;
  platform_share_usdt: number | string | null;
  distributor_share_usdt: number | string | null;
  requests: number | string | null;
}

const num = (v: unknown) => Number(v) || 0;

const cols: DataTableColumn<EpochRow>[] = [
  { key: "epoch_id", header: "Epoch", cell: (r) => <span className="font-mono text-xs font-semibold text-foreground">E{r.epoch_id}</span> },
  {
    key: "status",
    header: "Status",
    cell: (r) => {
      const s = String(r.status || "").toUpperCase();
      return <StatusBadge status={s === "CLOSED" || s === "FINALIZED" ? "active" : s === "OPEN" ? "pending" : "neutral"} label={s || "—"} />;
    },
  },
  { key: "total", header: "Revenue", align: "right", cell: (r) => <span className="font-mono text-xs text-emerald-400">${num(r.total).toFixed(4)}</span> },
  { key: "node_pool_usdt", header: "Node Pool", align: "right", cell: (r) => <span className="font-mono text-xs text-muted-foreground">${num(r.node_pool_usdt).toFixed(4)}</span> },
  { key: "platform_share_usdt", header: "Platform", align: "right", cell: (r) => <span className="font-mono text-xs text-muted-foreground">${num(r.platform_share_usdt).toFixed(4)}</span> },
  { key: "requests", header: "Requests", align: "right", cell: (r) => <span className="font-mono text-xs">{num(r.requests).toLocaleString()}</span> },
];

export default function AdminEpochsPage() {
  const [epochs, setEpochs] = useState<EpochRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/epochs")
      .then((r) => r.json())
      .then((d) => setEpochs(d?.ok && Array.isArray(d.epochs) ? d.epochs : []))
      .catch(() => setEpochs([]))
      .finally(() => setLoading(false));
  }, []);

  const open = epochs?.find((e) => String(e.status).toUpperCase() === "OPEN");
  const finalized = epochs?.filter((e) => ["CLOSED", "FINALIZED"].includes(String(e.status).toUpperCase())).length ?? 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <KPIGrid columns={3}>
        <StatCard label="Active Epoch" value={open ? `E${open.epoch_id}` : "—"} caption="Currently accumulating" icon={Compass} loading={loading} accent={!!open} />
        <StatCard label="Active Epoch Revenue" value={open ? `$${num(open.total).toFixed(4)} USDT` : "—"} caption="Accrued in the open epoch" icon={Trophy} loading={loading} />
        <StatCard label="Finalized Epochs" value={String(finalized)} caption="Closed / finalized rounds" icon={Layers} loading={loading} />
      </KPIGrid>

      <DashboardSection title="Reward Epochs" description="Epoch lifecycle and revenue split (from epochs table)" flush>
        <DataTable
          columns={cols}
          rows={epochs}
          rowKey={(r) => String(r.epoch_id)}
          loading={loading}
          emptyTitle="No epochs yet"
          emptyDescription="No epochs have been opened. The epoch scheduler creates these server-side."
        />
      </DashboardSection>
    </div>
  );
}
