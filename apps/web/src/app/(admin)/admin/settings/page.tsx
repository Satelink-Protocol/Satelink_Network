"use client";

import { useEffect, useState } from "react";
import { ShieldAlert, Cpu, Settings2 } from "lucide-react";
import { KPIGrid, StatCard, DashboardSection, Badge } from "@satelink/ui";
import { adminGet } from "../_lib/adminClient";

// /admin/config returns key names + sanitized values only — never secrets.
interface Config {
  PRICE_PER_CALL?: string;
  FREE_TIER_LIMIT?: string;
  SETTLEMENT_DRY_RUN?: string;
  MIN_ANCHOR_REVENUE_USDT?: string;
  CHAIN_ID?: string;
  REVENUE_VAULT?: string;
  USDT_ADDRESS?: string;
  BREVO_CONFIGURED?: string;
  ADMIN_TOKEN_CONFIGURED?: string;
  NOTE?: string;
}

const LABELS: Record<string, string> = {
  PRICE_PER_CALL: "Price per call (USDT)",
  FREE_TIER_LIMIT: "Free-tier daily limit (calls/IP)",
  SETTLEMENT_DRY_RUN: "Settlement dry-run",
  MIN_ANCHOR_REVENUE_USDT: "Min anchor revenue (USDT)",
  CHAIN_ID: "Chain ID",
  REVENUE_VAULT: "Revenue vault",
  USDT_ADDRESS: "USDT token",
  BREVO_CONFIGURED: "Brevo (email) configured",
  ADMIN_TOKEN_CONFIGURED: "Admin token configured",
};

export default function AdminSettingsPage() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminGet<Config>("config")
      .then(setCfg)
      .finally(() => setLoading(false));
  }, []);

  const dryRun = cfg?.SETTLEMENT_DRY_RUN === "1" || cfg?.SETTLEMENT_DRY_RUN === "true";
  const rows = Object.entries(LABELS).map(([key, label]) => ({ key, label, value: (cfg as Record<string, string> | null)?.[key] }));

  return (
    <div className="space-y-6 animate-fade-in">
      <KPIGrid columns={3}>
        <StatCard label="Settlement Dry-Run" value={cfg != null ? (dryRun ? "ON" : "OFF") : "—"} caption="1 = not broadcasting on-chain" icon={ShieldAlert} accent={dryRun} loading={loading} />
        <StatCard label="Price per Call" value={cfg?.PRICE_PER_CALL ? `$${cfg.PRICE_PER_CALL}` : "—"} caption="Billed rate per RPC call" icon={Settings2} loading={loading} />
        <StatCard label="Free-Tier Limit" value={cfg?.FREE_TIER_LIMIT ?? "—"} caption="Calls per IP per day" icon={Cpu} loading={loading} />
      </KPIGrid>

      <DashboardSection
        title="Live Configuration (read-only)"
        description="Sanitized runtime config from the API. Values are set in code / Railway env — this screen reflects them, it does not change them."
      >
        <div className="p-4">
          {rows.map((r) => (
            <div key={r.key} className="flex items-center justify-between gap-3 py-2 border-b border-border/50 last:border-0">
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-zinc-300">{r.label}</span>
                <span className="text-[10px] text-muted-foreground font-mono">{r.key}</span>
              </div>
              <span className="font-mono text-[11px] text-foreground select-all truncate max-w-[260px] text-right">
                {loading ? "…" : r.value ?? "—"}
              </span>
            </div>
          ))}
          <div className="pt-3 mt-1">
            <Badge className="bg-zinc-800 text-zinc-400 border-zinc-700 text-[10px]">
              Secret values are never returned — keys only.
            </Badge>
          </div>
        </div>
      </DashboardSection>
    </div>
  );
}
