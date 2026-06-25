"use client";

import { useState } from "react";
import { Trophy, Compass, Plus, AlertTriangle, RefreshCw } from "lucide-react";
import {
  Button,
  KPIGrid,
  StatCard,
  DashboardSection,
  DataTable,
  StatusBadge,
  Badge,
} from "@satelink/ui";

interface EpochRecord {
  id: number;
  status: "FINALIZED" | "RECONCILING" | "OPEN";
  totalNodesPaid: number;
  poolAmount: number;
  gasSpentPol: number;
  merkleVerified: boolean;
  timestamp: string;
}

const INITIAL_EPOCHS: EpochRecord[] = [
  { id: 489, status: "OPEN", totalNodesPaid: 104, poolAmount: 0.1245, gasSpentPol: 0.0, merkleVerified: false, timestamp: "Current Epoch" },
  { id: 488, status: "RECONCILING", totalNodesPaid: 104, poolAmount: 0.0984, gasSpentPol: 0.012, merkleVerified: true, timestamp: "20 mins ago" },
  { id: 487, status: "FINALIZED", totalNodesPaid: 102, poolAmount: 0.1042, gasSpentPol: 0.014, merkleVerified: true, timestamp: "30 mins ago" },
  { id: 486, status: "FINALIZED", totalNodesPaid: 98, poolAmount: 0.1521, gasSpentPol: 0.021, merkleVerified: true, timestamp: "40 mins ago" },
  { id: 485, status: "FINALIZED", totalNodesPaid: 96, poolAmount: 0.0874, gasSpentPol: 0.018, merkleVerified: true, timestamp: "50 mins ago" },
];

export default function AdminEpochsPage() {
  const [epochs, setEpochs] = useState<EpochRecord[]>(INITIAL_EPOCHS);
  const [loading, setLoading] = useState(false);

  const triggerEpochFinalize = () => {
    setLoading(true);
    setTimeout(() => {
      setEpochs((prev) => {
        const nextEpochId = prev[0].id + 1;
        const finalized = prev.map((e) =>
          e.status === "OPEN" ? { ...e, status: "FINALIZED" as const, merkleVerified: true, gasSpentPol: 0.015 } : e
        );
        return [
          { id: nextEpochId, status: "OPEN" as const, totalNodesPaid: 104, poolAmount: 0.0, gasSpentPol: 0.0, merkleVerified: false, timestamp: "Current Epoch" },
          ...finalized,
        ];
      });
      setLoading(false);
      alert("Epoch finalized! Ledger calculated and Merkle proofs generated.");
    }, 1500);
  };

  const cols = [
    {
      key: "id",
      header: "Epoch ID",
      cell: (r: EpochRecord) => <span className="font-mono text-xs font-semibold text-foreground">Epoch {r.id}</span>,
    },
    {
      key: "status",
      header: "Epoch Lifecycle",
      cell: (r: EpochRecord) => (
        <StatusBadge
          status={r.status === "FINALIZED" ? "active" : r.status === "RECONCILING" ? "pending" : "neutral"}
          label={r.status}
        />
      ),
    },
    {
      key: "totalNodesPaid",
      header: "Active Node Hosts",
      cell: (r: EpochRecord) => <span className="text-xs text-foreground font-mono">{r.totalNodesPaid} nodes</span>,
    },
    {
      key: "poolAmount",
      header: "Reward Pool",
      align: "right" as const,
      cell: (r: EpochRecord) => <span className="font-mono text-xs text-emerald-400">${r.poolAmount.toFixed(4)} USDT</span>,
    },
    {
      key: "gasSpentPol",
      header: "Payout Gas Fees",
      align: "right" as const,
      cell: (r: EpochRecord) => <span className="font-mono text-xs text-muted-foreground">{r.gasSpentPol.toFixed(3)} POL</span>,
    },
    {
      key: "merkleVerified",
      header: "Consensus Proof",
      cell: (r: EpochRecord) => (
        <Badge
          variant={r.merkleVerified ? "outline" : "secondary"}
          className={
            r.merkleVerified
              ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10 text-[10px]"
              : "text-zinc-500 text-[10px]"
          }
        >
          {r.merkleVerified ? "✓ Merkle Root Confirmed" : "—"}
        </Badge>
      ),
    },
    {
      key: "timestamp",
      header: "Ended",
      cell: (r: EpochRecord) => <span className="text-xs text-muted-foreground">{r.timestamp}</span>,
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <KPIGrid columns={3}>
        <StatCard
          label="Active Epoch ID"
          value={`E${epochs.find((e) => e.status === "OPEN")?.id ?? "—"}`}
          caption="Accumulating reward telemetry data"
          icon={Compass}
          accent
        />
        <StatCard
          label="Estimated Epoch Reward"
          value="0.1245 USDT"
          caption="Accrued value inside active pool"
          icon={Trophy}
        />
        <StatCard
          label="Finalized Epochs"
          value={String(epochs.filter((e) => e.status === "FINALIZED").length)}
          caption="Total reward distribution rounds completed"
        />
      </KPIGrid>

      <DashboardSection
        title="Reward Epoch Coordinator"
        description="Oversee the lifecycle of consensus-reward distribution pools"
        actions={
          <Button size="sm" onClick={triggerEpochFinalize} disabled={loading}>
            {loading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Finalize Active Epoch
          </Button>
        }
        flush
      >
        <DataTable columns={cols} rows={epochs} rowKey={(r) => String(r.id)} />
      </DashboardSection>
    </div>
  );
}
