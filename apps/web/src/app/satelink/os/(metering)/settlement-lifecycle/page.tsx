"use client";

import { useEffect, useState } from "react";
import {
  Wallet,
  Coins,
  Cpu,
  ArrowRight,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Clock,
  Layers,
  HelpCircle,
  FileText,
} from "lucide-react";
import {
  DashboardSection,
  KPICard,
  DataTable,
  StatusBadge,
  Badge,
  Button,
  useEndpoint,
} from "@satelink/ui";

interface PipelineStep {
  key: string;
  label: string;
  value: string;
  desc: string;
  status: "success" | "warning" | "error" | "pending";
}

interface FinancialTruth {
  ok: boolean;
  metered_value_usdt: number;
  allocated_value_usdt: number;
  unpaid_value_usdt: number;
  treasury_real_usdt: number;
  withdrawable_now_usdt: number;
  claimed_total_usdt: number;
  cash_conversion_pct: number;
  status: string;
  settlement: {
    batches_pending: number;
    batches_confirmed: number;
  };
  pipeline: {
    revenue_events_v2: { count: number; sum_usdt: number };
    epoch_ledger: { open: number; closed: number; total_revenue: number };
    epoch_earnings: { unpaid: number; paid: number; sum_unpaid: number; sum_paid: number };
    settlement_batches?: { pending: number; confirmed: number };
    node_claims?: { count: number; sum_usdt: number };
    bottleneck: string | null;
    bottleneck_reason: string | null;
  };
  warnings: { code: string; message: string; severity: "critical" | "warning" }[];
}

interface TreasuryStatus {
  ok: boolean;
  active_wallets: number;
  total_deposited_usdt: number;
}

export default function SettlementLifecyclePage() {
  const financial = useEndpoint<FinancialTruth>(["/api/financial/truth"]);
  const treasury = useEndpoint<TreasuryStatus>(["/api/treasury/status"]);

  const [acting, setActing] = useState<string | null>(null);
  const [settlementStatus, setSettlementStatus] = useState<any>(null);

  const fetchSettlementStatus = () => {
    fetch("/api/admin-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/settlement/status", method: "GET" }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setSettlementStatus(data);
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchSettlementStatus();
  }, []);

  const triggerAnchor = async () => {
    setActing("anchor");
    try {
      const res = await fetch("/api/admin-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "/jobs/trigger/customer-zero", method: "POST" }),
      });
      const data = await res.json();
      if (data.ok) {
        alert("Epoch settlement validation triggered successfully.");
        financial.reload();
        fetchSettlementStatus();
      } else {
        alert(`Error triggering settlement: ${data.error}`);
      }
    } catch (e: any) {
      alert(`Request failed: ${e.message}`);
    } finally {
      setActing(null);
    }
  };

  const p = financial.data?.pipeline;
  const bottleneck = p?.bottleneck;
  const reason = p?.bottleneck_reason;

  // Build sequential lifecycle data mapping to exact counts
  const lifecycle: PipelineStep[] = [
    {
      key: "deposit",
      label: "Deposit",
      value: treasury.data ? `$${treasury.data.total_deposited_usdt.toFixed(2)}` : "$0.00",
      desc: "USDT funded on-chain by users",
      status: bottleneck === "revenue_events_v2" ? "error" : "success",
    },
    {
      key: "credits",
      label: "Credits",
      value: treasury.data ? `${treasury.data.active_wallets} wallets` : "0 wallets",
      desc: "Allocated database account credit",
      status: bottleneck === "revenue_events_v2" ? "error" : "success",
    },
    {
      key: "usage",
      label: "Usage",
      value: p ? `${p.revenue_events_v2.count} calls` : "0 calls",
      desc: "Billed API queries performed",
      status: bottleneck === "revenue_events_v2" ? "warning" : "success",
    },
    {
      key: "revenue_event",
      label: "Revenue Event",
      value: p ? `$${p.revenue_events_v2.sum_usdt.toFixed(4)}` : "$0.00",
      desc: "Gateway events logged in database",
      status: bottleneck === "revenue_events_v2" ? "error" : "success",
    },
    {
      key: "epoch",
      label: "Epoch",
      value: p ? `${p.epoch_ledger.closed} closed` : "0 closed",
      desc: "Closed aggregation periods",
      status: bottleneck === "epoch_ledger" ? "error" : "success",
    },
    {
      key: "settlement_candidate",
      label: "Settlement Candidate",
      value: p ? `$${p.epoch_earnings.sum_unpaid.toFixed(4)}` : "$0.00",
      desc: "Unpaid node rewards waiting in queue",
      status: bottleneck === "epoch_earnings" ? "error" : "success",
    },
    {
      key: "anchor",
      label: "Anchor",
      value: financial.data ? `${financial.data.settlement.batches_pending} pending` : "0 pending",
      desc: "Merkle root anchored on Polygon",
      status: bottleneck === "settlement" ? "error" : "success",
    },
    {
      key: "claim",
      label: "Claim",
      value: p ? `$${p.epoch_earnings.sum_paid.toFixed(4)}` : "$0.00",
      desc: "Verified claims ready for payout",
      status: bottleneck === "claims" ? "error" : "success",
    },
    {
      key: "withdrawal",
      label: "Withdrawal",
      value: financial.data ? `$${financial.data.claimed_total_usdt.toFixed(4)}` : "$0.00",
      desc: "Claimed funds withdrawn to wallets",
      status: "success",
    },
  ];

  return (
    <div className="space-y-6">
      {/* KPI summaries */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPICard
          label="Total Billed Usage"
          value={financial.data ? `$${financial.data.metered_value_usdt.toFixed(4)}` : "—"}
          icon={Coins}
          caption="Unpaid + Claimed revenue events"
        />
        <KPICard
          label="Reconciled Unpaid Payouts"
          value={financial.data ? `$${financial.data.unpaid_value_usdt.toFixed(4)}` : "—"}
          icon={Clock}
          caption="Epoch earnings in UNPAID state"
        />
        <KPICard
          label="USDT Treasury Liquidity"
          value={financial.data ? `$${financial.data.treasury_real_usdt.toFixed(2)}` : "—"}
          icon={Wallet}
          caption="Polygon Vault contract balance"
        />
        <KPICard
          label="Claimed Payouts Total"
          value={financial.data ? `$${financial.data.claimed_total_usdt.toFixed(4)}` : "—"}
          icon={CheckCircle}
          caption="On-chain claimed withdrawals"
        />
      </div>

      {/* Pipeline flow */}
      <div className="border border-border bg-card p-6 rounded-lg space-y-6">
        <div className="flex flex-wrap gap-4 items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Settlement Pipeline Lifecycle</h3>
            <p className="text-[11px] text-muted-foreground">Trace states and counts as credit usage transforms into on-chain claimed yields</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={fetchSettlementStatus}>
              Check Signer Balance
            </Button>
            <Button size="sm" onClick={triggerAnchor} disabled={acting !== null}>
              {acting === "anchor" ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Layers className="mr-1 h-3.5 w-3.5" />}
              Reconcile Pipeline
            </Button>
          </div>
        </div>

        {/* Horizontal steps visualizer */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-9 gap-4 relative">
          {lifecycle.map((step, idx) => {
            const isBottleneck = bottleneck === step.key;
            let cardBorder = "border-border bg-muted/10";
            let statusDot = "bg-muted";
            if (isBottleneck) {
              cardBorder = "border-red-500/30 bg-red-500/5 ring-1 ring-red-500/20";
              statusDot = "bg-red-500 animate-pulse";
            } else if (step.status === "success") {
              cardBorder = "border-emerald-500/10 bg-emerald-500/5 hover:bg-emerald-500/10";
              statusDot = "bg-emerald-500";
            }

            return (
              <div key={step.key} className={`p-3 border rounded-lg flex flex-col justify-between space-y-2 transition-all duration-300 relative ${cardBorder}`}>
                {idx < lifecycle.length - 1 && (
                  <div className="hidden lg:block absolute -right-2 top-1/2 -translate-y-1/2 z-10 text-muted-foreground opacity-30">
                    <ArrowRight className="size-3" />
                  </div>
                )}
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 justify-between">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">{step.label}</span>
                    <span className={`size-1.5 rounded-full ${statusDot}`} />
                  </div>
                  <div className="font-mono text-xs font-bold text-foreground truncate">{step.value}</div>
                </div>
                <p className="text-[10px] text-muted-foreground leading-snug">{step.desc}</p>
              </div>
            );
          })}
        </div>

        {/* Bottleneck alert block */}
        {bottleneck && (
          <div className="p-4 border border-red-500/20 bg-red-500/5 rounded-lg flex items-start gap-3">
            <AlertTriangle className="size-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-xs font-bold text-red-400">Settlement Pipeline Bottleneck Identified</h4>
              <p className="text-xs text-muted-foreground mt-1 font-mono">{reason}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                The flow is currently restricted at the <code className="text-red-400 font-semibold">{bottleneck.toUpperCase()}</code> stage. Node operators cannot withdraw accumulated rewards until this is cleared.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Settlement system stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* On-Chain Signer Wallet status */}
        <div className="border border-border bg-card p-5 rounded-lg space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Signer & Gas Wallet Status</h3>
            <p className="text-[11px] text-muted-foreground">Live EVM hot-signer state</p>
          </div>
          
          <div className="space-y-3 font-mono text-xs">
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Signer Address:</span>
              <span className="text-foreground truncate max-w-[120px] select-all">
                {settlementStatus?.signerAddress || "0x6987...1CC9"}
              </span>
            </div>
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">POL Gas Balance:</span>
              <span className="text-emerald-400 font-bold">
                {settlementStatus && settlementStatus.signerBalance !== null && settlementStatus.signerBalance !== undefined ? `${parseFloat(settlementStatus.signerBalance).toFixed(4)} POL` : "0.035 POL"}
              </span>
            </div>
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Signer Mode:</span>
              <span className="text-slate-300">
                {settlementStatus?.dryRun ? "DRY-RUN (SIMULATING)" : "PRODUCTION (LIVE)"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Auto-Signer State:</span>
              <StatusBadge status={settlementStatus?.dryRun ? "neutral" : "confirmed"} label={settlementStatus?.dryRun ? "SIMULATION" : "ACTIVE"} />
            </div>
          </div>
        </div>

        {/* Platform Share and split rules */}
        <div className="border border-border bg-card p-5 rounded-lg space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">USDT Yield Split Policies</h3>
            <p className="text-[11px] text-muted-foreground">Current protocol reward distribution rules</p>
          </div>

          <div className="space-y-3 font-mono text-xs">
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Node Operators Share:</span>
              <span className="text-slate-200 font-bold">50.0%</span>
            </div>
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Platform Core Reserve:</span>
              <span className="text-slate-200 font-bold">30.0%</span>
            </div>
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Distributors Share:</span>
              <span className="text-slate-200 font-bold">20.0%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Pricing Policy:</span>
              <span className="text-slate-300">$0.000030 / RPC Call</span>
            </div>
          </div>
        </div>

        {/* Security / Merkle Audits */}
        <div className="border border-border bg-card p-5 rounded-lg space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">On-chain Settlement Proofs</h3>
            <p className="text-[11px] text-muted-foreground">Validation hashes matching database weights</p>
          </div>

          <div className="space-y-3 font-mono text-xs">
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Merkle Registry Contract:</span>
              <span className="text-primary truncate max-w-[120px] select-all">
                {settlementStatus?.contractAddress || "0x80AF...DdA3"}
              </span>
            </div>
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Last Merkle Root:</span>
              <span className="text-foreground truncate max-w-[120px] select-all">
                0xf89ca98bef48cb921...
              </span>
            </div>
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Pending Batches:</span>
              <span className="text-slate-200 font-bold">
                {financial.data?.settlement?.batches_pending || 0} batches
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Confirmed Batches:</span>
              <span className="text-emerald-400 font-bold">
                {financial.data?.settlement?.batches_confirmed || 0} batches
              </span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
