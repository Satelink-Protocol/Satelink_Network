"use client";

import { useEffect, useState } from "react";
import { Landmark, FileCheck, Coins, Fuel } from "lucide-react";
import { KPIGrid, StatCard, DashboardSection, Badge } from "@satelink/ui";
import { adminGet } from "../_lib/adminClient";

interface Treasury {
  dry_run: boolean;
  signer_balance_pol: number | string | null;
  signer_address: string | null;
  vault_address: string | null;
  usdt_address: string | null;
  treasury_address: string | null;
  pending_batches: number;
  blocked_unfunded_batches: number;
  confirmed_batches: number;
  confirmed_usdt: number;
  blocked_unfunded_usdt: number;
  min_anchor_usdt: number;
  threshold_met: boolean;
}

const num = (v: unknown) => Number(v) || 0;

function Addr({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs py-1.5 border-b border-border/50 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-[11px] text-foreground select-all truncate max-w-[220px]">{value || "—"}</span>
    </div>
  );
}

export default function AdminLedgerPage() {
  const [t, setT] = useState<Treasury | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminGet<Treasury>("treasury/status")
      .then(setT)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6 animate-fade-in">
      <KPIGrid columns={4}>
        <StatCard
          label="Settled On-Chain (USDT)"
          value={t != null ? `$${num(t.confirmed_usdt).toFixed(4)}` : "—"}
          caption="Confirmed settlement batches"
          icon={Landmark}
          accent
          loading={loading}
        />
        <StatCard
          label="Confirmed Batches"
          value={t != null ? String(num(t.confirmed_batches)) : "—"}
          caption="Finalized distribution runs"
          icon={FileCheck}
          loading={loading}
        />
        <StatCard
          label="Settlement Mode"
          value={t != null ? (t.dry_run ? "DRY RUN" : "LIVE") : "—"}
          caption={t != null ? (t.dry_run ? "Not broadcasting to chain" : "Broadcasting on-chain") : undefined}
          icon={Coins}
          accent={t != null && !t.dry_run}
          loading={loading}
        />
        <StatCard
          label="Signer Balance (POL)"
          value={t?.signer_balance_pol != null ? `${num(t.signer_balance_pol).toFixed(4)}` : "—"}
          caption={t != null && t.signer_balance_pol == null ? "Balance lookup unavailable" : "Hot signer gas reserve"}
          icon={Fuel}
          loading={loading}
        />
      </KPIGrid>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DashboardSection title="Settlement Batch Breakdown" description="Distribution runs grouped by status (settlement_batches)">
          <div className="p-4 space-y-3">
            <BatchRow label="Confirmed" count={num(t?.confirmed_batches)} usdt={num(t?.confirmed_usdt)} tone="emerald" />
            <BatchRow label="Pending" count={num(t?.pending_batches)} tone="amber" />
            <BatchRow label="Blocked (unfunded signer)" count={num(t?.blocked_unfunded_batches)} usdt={num(t?.blocked_unfunded_usdt)} tone="red" />
            <div className="flex items-center justify-between pt-3 mt-1 border-t border-border text-xs">
              <span className="text-muted-foreground">Anchor threshold ({num(t?.min_anchor_usdt).toFixed(2)} USDT)</span>
              <Badge
                className={
                  t?.threshold_met
                    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px]"
                    : "bg-zinc-800 text-zinc-400 border-zinc-700 text-[10px]"
                }
              >
                {t?.threshold_met ? "MET" : "not met"}
              </Badge>
            </div>
          </div>
        </DashboardSection>

        <DashboardSection title="On-Chain Addresses" description="Vault, signer and token addresses (Polygon 137)">
          <div className="p-4">
            <Addr label="Revenue Vault" value={t?.vault_address ?? null} />
            <Addr label="Signer" value={t?.signer_address ?? null} />
            <Addr label="Treasury" value={t?.treasury_address ?? null} />
            <Addr label="USDT" value={t?.usdt_address ?? null} />
          </div>
        </DashboardSection>
      </div>
    </div>
  );
}

function BatchRow({
  label,
  count,
  usdt,
  tone,
}: {
  label: string;
  count: number;
  usdt?: number;
  tone: "emerald" | "amber" | "red";
}) {
  const dot = tone === "emerald" ? "bg-emerald-500" : tone === "amber" ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="flex items-center gap-2 text-muted-foreground">
        <span className={`h-2 w-2 rounded-full ${dot}`} /> {label}
      </span>
      <span className="font-mono text-foreground">
        {count.toLocaleString()}
        {usdt !== undefined ? <span className="text-muted-foreground"> · ${usdt.toFixed(4)}</span> : null}
      </span>
    </div>
  );
}
