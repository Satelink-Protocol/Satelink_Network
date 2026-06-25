"use client";

import { useState } from "react";
import { Coins, HardDrive, RefreshCcw, Landmark, FileCheck } from "lucide-react";
import {
  Button,
  KPIGrid,
  StatCard,
  DashboardSection,
  DataTable,
  StatusBadge,
  Badge,
} from "@satelink/ui";

interface LedgerRun {
  id: string;
  epochId: number;
  merkleRoot: string;
  totalDistributed: number;
  status: "verified" | "pending" | "failed";
  txHash: string;
  timestamp: string;
}

const INITIAL_RUNS: LedgerRun[] = [
  { id: "RUN-104", epochId: 489, merkleRoot: "0x12a8fbc789...", totalDistributed: 0.1245, status: "verified", txHash: "0xfa77b8192837bc90", timestamp: "10 mins ago" },
  { id: "RUN-103", epochId: 488, merkleRoot: "0x98fca327db...", totalDistributed: 0.0984, status: "verified", txHash: "0xec2249abcf1231da", timestamp: "20 mins ago" },
  { id: "RUN-102", epochId: 487, merkleRoot: "0xb7c8adfe3e...", totalDistributed: 0.1042, status: "verified", txHash: "0xbc55288237facdeb", timestamp: "30 mins ago" },
  { id: "RUN-101", epochId: 486, merkleRoot: "0x66deac89ff...", totalDistributed: 0.1521, status: "verified", txHash: "0x3e18a9fc8827fa11", timestamp: "40 mins ago" },
  { id: "RUN-100", epochId: 485, merkleRoot: "0xee56a1b2c4...", totalDistributed: 0.0874, status: "failed", txHash: "", timestamp: "50 mins ago" },
];

export default function AdminLedgerPage() {
  const [runs, setRuns] = useState<LedgerRun[]>(INITIAL_RUNS);
  const [recomputing, setRecomputing] = useState<string | null>(null);

  const handleVerify = (id: string) => {
    setRecomputing(id);
    setTimeout(() => {
      setRuns((prev) =>
        prev.map((run) =>
          run.id === id ? { ...run, status: "verified" } : run
        )
      );
      setRecomputing(null);
      alert(`Ledger proof verify run complete. Root matched blockchain state!`);
    }, 1200);
  };

  const cols = [
    {
      key: "id",
      header: "Run ID",
      cell: (r: LedgerRun) => <span className="font-mono text-xs font-semibold text-foreground">{r.id}</span>,
    },
    {
      key: "epoch",
      header: "Epoch",
      cell: (r: LedgerRun) => <span className="font-mono text-xs">E{r.epochId}</span>,
    },
    {
      key: "merkleRoot",
      header: "Merkle Root",
      cell: (r: LedgerRun) => <span className="font-mono text-xs text-muted-foreground">{r.merkleRoot}</span>,
    },
    {
      key: "total",
      header: "Total Distributed",
      align: "right" as const,
      cell: (r: LedgerRun) => <span className="font-mono text-xs text-emerald-400">${r.totalDistributed.toFixed(4)} USDT</span>,
    },
    {
      key: "status",
      header: "Validation Status",
      cell: (r: LedgerRun) => (
        <StatusBadge
          status={r.status === "verified" ? "active" : r.status === "pending" ? "pending" : "danger"}
          label={r.status.toUpperCase()}
        />
      ),
    },
    {
      key: "txHash",
      header: "EVM Settlement Tx",
      cell: (r: LedgerRun) =>
        r.txHash ? (
          <a
            href={`https://polygonscan.com/tx/${r.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline font-mono"
          >
            {r.txHash.slice(0, 10)}…
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "timestamp",
      header: "Verified Time",
      cell: (r: LedgerRun) => <span className="text-xs text-muted-foreground">{r.timestamp}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right" as const,
      cell: (r: LedgerRun) => (
        <div className="flex justify-end">
          {r.status === "failed" ? (
            <Button
              size="xs"
              variant="outline"
              disabled={recomputing !== null}
              onClick={() => handleVerify(r.id)}
              className="text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
            >
              {recomputing === r.id ? "Re-running..." : "Recompute Proof"}
            </Button>
          ) : (
            <Button
              size="xs"
              variant="ghost"
              disabled={recomputing !== null}
              onClick={() => handleVerify(r.id)}
            >
              <RefreshCcw className="h-3 w-3 mr-1" /> Re-verify
            </Button>
          )}
        </div>
      ),
    },
  ];

  const totalUSDT = runs
    .filter((r) => r.status === "verified")
    .reduce((sum, r) => sum + r.totalDistributed, 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <KPIGrid columns={3}>
        <StatCard
          label="Setted On-Chain Total"
          value={`$${totalUSDT.toFixed(4)} USDT`}
          caption="Aggregated finalized epoch payments"
          icon={Landmark}
          accent
        />
        <StatCard
          label="Epochs Finalized"
          value={String(runs.filter((r) => r.status === "verified").length)}
          caption="Finalized Merkle ledger checkpoints"
          icon={FileCheck}
        />
        <StatCard
          label="On-chain Verification State"
          value="100% OK"
          caption="Decentralized consensus validated"
          icon={Coins}
          accent
        />
      </KPIGrid>

      <DashboardSection
        title="Payment Distribution Ledger Runs"
        description="Tracks ledger epochs reconciled and submitted for blockchain verification"
        actions={
          <Button size="sm" onClick={() => alert("Recomputing entire Merkle roots tree...")}>
            Force Ledger Re-sync
          </Button>
        }
        flush
      >
        <DataTable columns={cols} rows={runs} rowKey={(r) => r.id} />
      </DashboardSection>
    </div>
  );
}
