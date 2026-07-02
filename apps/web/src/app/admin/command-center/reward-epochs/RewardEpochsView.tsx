"use client";

// Reward Epochs — REAL epoch + settlement accounting, no fabricated payouts.
//   Epoch totals   → GET /api/economics/summary  (epochs table: CLOSED/FINALIZED, non-phantom)
//   Settlement pool → GET /admin/treasury/status  (settlement_batches by status + signer/dry-run)
//   Active nodes    → GET /admin/network/health   (registered_nodes active count)
// Settlement is in DRY_RUN, so there are NO on-chain Merkle roots or TX hashes — the
// page states that honestly and never renders a "verified" checkmark it can't prove.

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Trophy, Coins, Layers, ShieldAlert } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  KPICard,
  StatusPill,
  EmptyState,
} from "@satelink/ui";

async function adminFetch(path: string) {
  const res = await fetch("/api/admin-proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, method: "GET" }),
  });
  return res.json();
}

interface Economics {
  ok: boolean;
  totalRevenueUsdt: number;
  totalNodePoolUsdt: number;
  totalPlatformShareUsdt: number;
  totalDistributorShareUsdt: number;
  splitRatio: { nodeOperators: number; platform: number; distributors: number };
  lastEpochId: number;
  lastEpochRevenueUsdt: number;
  lastEpochClosedAt: string | null;
}

interface Treasury {
  dry_run: boolean;
  signer_balance_pol: number | null;
  pending_batches: number;
  blocked_unfunded_batches: number;
  confirmed_batches: number;
  confirmed_usdt: number;
  blocked_unfunded_usdt: number;
}

const usd5 = (n: number | null | undefined) =>
  `$${(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 5, maximumFractionDigits: 5 })}`;

export default function RewardEpochsView() {
  const [eco, setEco] = useState<Economics | null>(null);
  const [treas, setTreas] = useState<Treasury | null>(null);
  const [nodes, setNodes] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [e, t, n] = await Promise.all([
        fetch("/api/economics/summary", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        adminFetch("/treasury/status"),
        adminFetch("/network/health"),
      ]);
      if (e?.ok) setEco(e as Economics); else setEco(null);
      if (t?.ok && t.data) setTreas(t.data as Treasury); else setTreas(null);
      if (n?.ok && n.data) setNodes(typeof n.data.active_nodes === "number" ? n.data.active_nodes : null);
      if (!e?.ok && !t?.ok) setErr(t?.error || "epoch/settlement endpoints unreachable");
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : "request failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const split = eco?.splitRatio ?? { nodeOperators: 50, platform: 30, distributors: 20 };
  const isDryRun = treas?.dry_run ?? true;

  const allocations = [
    { label: "Node Operators", pct: split.nodeOperators, usdt: eco?.totalNodePoolUsdt },
    { label: "Platform", pct: split.platform, usdt: eco?.totalPlatformShareUsdt },
    { label: "Distribution Pool", pct: split.distributors, usdt: eco?.totalDistributorShareUsdt },
  ];

  const batches = treas ? [
    { status: "confirmed", label: "Confirmed", count: treas.confirmed_batches, usdt: treas.confirmed_usdt, state: "healthy" as const },
    { status: "pending", label: "Pending", count: treas.pending_batches, usdt: null as number | null, state: "degraded" as const },
    { status: "blocked_unfunded", label: "Blocked (unfunded)", count: treas.blocked_unfunded_batches, usdt: treas.blocked_unfunded_usdt, state: "critical" as const },
  ] : [];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KPICard label="Last Closed Epoch" icon={Layers} value={eco ? (eco.lastEpochId ? `#${eco.lastEpochId}` : "—") : "—"} caption={eco?.lastEpochId ? (eco.lastEpochClosedAt ? `closed ${new Date(eco.lastEpochClosedAt).toLocaleDateString()}` : "closed (time n/a)") : "no closed epoch yet"} />
        <KPICard label="Last Epoch Revenue" icon={Coins} value={eco ? usd5(eco.lastEpochRevenueUsdt) : "—"} caption="real, non-phantom" />
        <KPICard label="Lifetime Epoch Revenue" icon={Trophy} value={eco ? usd5(eco.totalRevenueUsdt) : "—"} caption="all closed epochs" />
        <KPICard label="Active Nodes" icon={Layers} value={nodes != null ? String(nodes) : "—"} caption="registered & active" />
      </div>

      {isDryRun ? (
        <div className="flex items-center gap-2 rounded-sm border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          <ShieldAlert className="size-4 text-amber-400 shrink-0" />
          <span className="text-xs text-amber-300">
            Settlement is in <span className="font-mono font-semibold">DRY_RUN</span> — no on-chain broadcast, so there are no settlement TX hashes or Merkle roots to verify. Amounts below are ledger accruals, not confirmed on-chain payouts.
          </span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Reward split — real split ratio + accrued allocations */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Reward Split & Allocations</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">Economic split across all closed epochs.</p>
          </CardHeader>
          <CardContent>
            {eco ? (
              <div className="divide-y divide-border">
                {allocations.map((a) => (
                  <div key={a.label} className="flex items-center justify-between py-2.5">
                    <div>
                      <div className="text-sm text-foreground">{a.label}</div>
                      <div className="text-[11px] text-muted-foreground">{a.pct}% share</div>
                    </div>
                    <span className="font-mono text-sm text-foreground tabular-nums">{usd5(a.usdt)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No epoch economics yet" description={err ?? "economics/summary unreachable from this session."} />
            )}
          </CardContent>
        </Card>

        {/* Settlement batches — real on-chain settlement pipeline state */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Settlement Pipeline</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">settlement_batches grouped by status.</p>
          </CardHeader>
          <CardContent>
            {treas ? (
              <div className="divide-y divide-border">
                {batches.map((b) => (
                  <div key={b.status} className="flex items-center justify-between py-2.5">
                    <div className="flex items-center gap-2.5">
                      <StatusPill status={b.status} state={b.state} label={b.label} />
                      <span className="font-mono text-sm text-foreground tabular-nums">{b.count.toLocaleString()}</span>
                    </div>
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">{b.usdt != null ? usd5(b.usdt) : "—"}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-xs text-muted-foreground">Signer balance (POL)</span>
                  <span className="font-mono text-xs tabular-nums text-foreground">
                    {treas.signer_balance_pol == null ? "null — unreadable" : `${treas.signer_balance_pol}`}
                  </span>
                </div>
              </div>
            ) : (
              <EmptyState title="No settlement data yet" description={err ?? "treasury/status unreachable from this session."} />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={load} disabled={loading} className="flex items-center gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>
    </div>
  );
}
