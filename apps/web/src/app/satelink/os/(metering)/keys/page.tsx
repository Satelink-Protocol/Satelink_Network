"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { KeyRound, Wallet, Send, ShieldCheck, AlertTriangle, TrendingUp, Activity } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Button,
  Input,
  DataTable,
  StatusBadge,
  AsyncBoundary,
  Badge,
  KPICard,
  BarChartPanel,
  DonutChart,
  Modal,
  type DataTableColumn,
} from "@satelink/ui";
import { useApiKeys, maskKey, type UsageSummary } from "@/lib/api-keys";
import { CopyButton } from "@/components/billing/shared";
import { WalletRegisterCard } from "@/components/keys/WalletRegisterCard";

interface KeyRow {
  key: string;
  name: string;
  tier: string;
  limit: number;
  requestsToday: number;
  creditsConsumed: number;
  creditsRemaining: number;
  status: string;
  lastUsed: string;
}

export default function KeysPage() {
  // ----- Core API key handling -----
  const { keys, addKey, removeKey, nameOf } = useApiKeys();
  const [rows, setRows] = useState<KeyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [revealKey, setRevealKey] = useState<string | null>(null);

  // ----- Fetch usage for each key -----
  const fetchRows = useCallback(async (list: string[]) => {
    if (list.length === 0) {
      setRows([]);
      return;
    }
    setLoading(true);
    const out: KeyRow[] = [];
    for (const key of list) {
      try {
        const res = await fetch("/api/keys/usage", {
          headers: { "X-API-Key": key },
          cache: "no-store",
        });
        const body = (await res.json()) as UsageSummary;
        if (res.ok) {
          out.push({
            key,
            name: nameOf(key),
            tier: body.tier || "free",
            limit: body.daily_limit ?? 500,
            requestsToday: body.requests_today ?? 0,
            creditsConsumed: body.total_spent_usdt ?? 0,
            creditsRemaining: body.credits_remaining ?? 0,
            status: body.status || "active",
            lastUsed: body.requests_today && body.requests_today > 0 ? "Active today" : "—",
          });
        }
      } catch {
        // skip unreadable key
      }
    }
    setRows(out);
    setLoading(false);
  }, [nameOf]);

  useEffect(() => {
    fetchRows(keys);
  }, [keys, fetchRows]);

  // ----- Create new key -----
  const handleCreateKey = async () => {
    const label = newLabel.trim() || "My API Key";
    setError(null);
    setCreating(true);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label,
          email: newEmail.trim() || undefined,
          email_consent: !!newEmail.trim(),
          tier: "free",
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Failed to create API key");
      addKey(body.api_key, label);
      setRevealKey(body.api_key);
      setShowCreate(false);
      setNewLabel("");
      setNewEmail("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setCreating(false);
    }
  };

  // ----- KPI calculations — all derived from real /api/keys/usage rows.
  // (A fabricated "Revenue Impact = spend × 1.2" card and a backend-less
  // "Alerts" card lived here — removed in the 2026-07 data-truth audit.)
  const keysNearLimit = useMemo(() => {
    return rows.filter((r) => r.creditsRemaining / r.limit < 0.1 || r.requestsToday > r.limit * 0.9).length;
  }, [rows]);
  const totalSpendingToday = useMemo(() => rows.reduce((sum, r) => sum + r.creditsConsumed, 0), [rows]);
  const totalRequestsToday = useMemo(() => rows.reduce((sum, r) => sum + r.requestsToday, 0), [rows]);
  const totalCreditsRemaining = useMemo(() => rows.reduce((sum, r) => sum + r.creditsRemaining, 0), [rows]);

  const throughputData = useMemo(() => {
    return rows.map((r) => ({ x: r.name, y: r.requestsToday }));
  }, [rows]);

  const costData = useMemo(() => {
    return rows.map((r) => ({ name: r.name, value: parseFloat(r.creditsConsumed.toFixed(5)) }));
  }, [rows]);

  // ----- DataTable columns -----
  const columns: DataTableColumn<KeyRow>[] = [
    { key: "name", header: "Label", cell: (k) => <span className="font-medium text-foreground">{k.name}</span> },
    {
      key: "id",
      header: "Key",
      cell: (k) => (
        <div className="flex items-center gap-1.5">
          <span className="select-all rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {maskKey(k.key)}
          </span>
          <CopyButton value={k.key} size="icon" label="Copy full key" />
          <Button variant="ghost" size="xs" onClick={() => setRevealKey(k.key)}>
            Reveal
          </Button>
        </div>
      ),
    },
    { key: "tier", header: "Tier / Limit", cell: (k) => <span className="font-mono text-xs uppercase">{k.tier} ({k.limit.toLocaleString()}/d)</span> },
    { key: "requests", header: "Requests Today", align: "right", cell: (k) => <span className="font-mono">{k.requestsToday.toLocaleString()}</span> },
    { key: "consumed", header: "Credits Used", align: "right", cell: (k) => <span className="font-mono">${k.creditsConsumed.toFixed(5)}</span> },
    { key: "lastUsed", header: "Last Used", cell: (k) => <span className="text-xs text-muted-foreground">{k.lastUsed}</span> },
    { key: "status", header: "Status", cell: (k) => <StatusBadge status={k.status} /> },
    {
      key: "action",
      header: "",
      align: "right",
      cell: (k) => (
        <div className="flex gap-1.5">
          {/* Per-key budget caps need a real gateway endpoint before a control
              can exist here — the old modal faked its save (audit #31). */}
          <Button variant="ghost" size="xs" className="text-destructive hover:text-destructive" onClick={() => { if (confirm(`Revoke "${k.name}" from this device? The key string is removed locally.`)) removeKey(k.key); }}>
            Revoke
          </Button>
        </div>
      ),
    },
  ];

  // ----- Render -----
  return (
    <div className="space-y-6">
      {/* One-click wallet onboarding — MetaMask signature → /v1/machine/register */}
      <WalletRegisterCard
        onRegistered={(apiKey, wallet) => {
          addKey(apiKey, `Wallet ${wallet.slice(0, 6)}…${wallet.slice(-4)}`);
          setRevealKey(apiKey);
        }}
      />

      {/* KPI Overview */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPICard
          label="Keys Near Limit"
          icon={AlertTriangle}
          value={keysNearLimit}
          caption={keysNearLimit > 0 ? `${keysNearLimit} key(s) approaching quota` : "All healthy"}
        />
        <KPICard
          label="Spending Today"
          icon={TrendingUp}
          value={`$${totalSpendingToday.toFixed(5)}`}
          caption={rows.length ? `${rows.length} active key(s)` : "—"}
        />
        <KPICard
          label="Requests Today"
          icon={Activity}
          value={totalRequestsToday.toLocaleString()}
          caption="across your keys"
        />
        <KPICard
          label="Credits Remaining"
          icon={Wallet}
          value={`$${totalCreditsRemaining.toFixed(5)}`}
          caption={totalCreditsRemaining > 0 ? `≈ ${Math.floor(totalCreditsRemaining / 0.00003).toLocaleString()} calls left` : "Deposit to add credits"}
        />
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: Keys Table */}
        <div className="lg:col-span-2 space-y-6">
          {/* Reveal new key */}
          {revealKey && (
            <Card className="glow-card glass-panel border-success/40 bg-success/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-success">
                  <ShieldCheck className="size-4" /> Your API key — copy it now
                </CardTitle>
                <CardDescription>
                  Save this key — it cannot be recovered. This is the only time the full key is shown.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2">
                <code className="block flex-1 break-all rounded-md border border-border bg-background/60 px-3 py-2 font-mono text-xs text-foreground">{revealKey}</code>
                <CopyButton value={revealKey} size="sm" variant="secondary" label="Copy key" />
                <Button size="sm" variant="ghost" onClick={() => setRevealKey(null)}>Dismiss</Button>
              </CardContent>
            </Card>
          )}

          {/* Keys Table */}
          <AsyncBoundary
            loading={loading && rows.length === 0}
            isEmpty={!loading && rows.length === 0}
            emptyTitle="No API keys yet"
            emptyDescription="Create your first key above — it takes one click and includes a free tier."
            emptyAction={<span className="text-[11px] text-muted-foreground">Next: fund credits on the Deposit page.</span>}
          >
            <DataTable columns={columns} rows={rows} rowKey={(k) => k.key} />
          </AsyncBoundary>
        </div>

        {/* Right: Key Health Panel */}
        <div className="space-y-6 min-w-0">
          {/* Free Tier Limits — static product spec, not live metrics */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-sm p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">Free Tier Limits</div>
            <div className="flex justify-between items-center py-2 border-b border-zinc-800/50">
              <span className="text-xs text-zinc-500">Daily quota (per IP)</span>
              <span className="text-sm font-mono text-white tabular-nums">500 calls/day</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-zinc-800/50">
              <span className="text-xs text-zinc-500">Shared quota (per /24 subnet)</span>
              <span className="text-sm font-mono text-white tabular-nums">500 calls/day</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-zinc-800/50 last:border-0">
              <span className="text-xs text-zinc-500">Metered rate</span>
              <span className="text-sm font-mono text-white tabular-nums">$0.00003 / call</span>
            </div>
            <p className="mt-3 text-[11px] text-zinc-600">
              Reference — static tier spec. Deposit USDT on the Credits page to continue past the free tier.
            </p>
          </div>
          <div className="min-w-0 h-[220px] relative">
            <BarChartPanel
              title="Daily Throughput per Key"
              data={throughputData.length > 0 ? throughputData : null}
              emptyNote="No active keys telemetry found."
            />
          </div>
          <div className="min-w-0 h-[220px] relative">
            <DonutChart
              title="Credit Usage Share"
              data={costData.length > 0 ? costData : null}
              emptyNote="No active key credit usage recorded."
            />
          </div>
        </div>
      </div>

      {/* Quick Actions Bar */}
      <div className="flex gap-2 justify-end py-2">
        <Button onClick={() => { setError(null); setShowCreate(true); }}>
          Add New Key
        </Button>
        <Button variant="destructive" onClick={() => {
          if (confirm("Bulk revoke all keys? This cannot be undone.")) {
            keys.forEach((k) => removeKey(k));
          }
        }}>
          Bulk Revoke
        </Button>
        <Button variant="secondary" onClick={() => {
          const csv = rows.map(r => [r.name, r.key, r.tier, r.limit, r.requestsToday, r.creditsConsumed, r.status].join(",")).join("\n");
          const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = "api_keys.csv"; a.click();
          URL.revokeObjectURL(url);
        }}>
          Export CSV
        </Button>
      </div>

      {/* Create Key Modal — canonical @satelink/ui Modal (opaque surface,
          blurred backdrop, right-aligned actions; fixes the transparent-modal bug) */}
      <Modal
        open={showCreate}
        onOpenChange={(o) => { if (!o) setShowCreate(false); }}
        title="Create API Key"
        description="Generate a new free-tier key. Opt in to updates if you like."
        footer={
          <>
            <Button size="sm" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button size="sm" onClick={handleCreateKey} disabled={creating}>{creating ? "Creating…" : "Create Key"}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-muted-foreground">Label</label>
            <Input
              placeholder="My API Key"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-muted-foreground">Email (optional)</label>
            <Input
              type="email"
              placeholder="you@example.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="text-xs"
            />
            <p className="text-[11px] text-muted-foreground">Receive network updates and usage alerts</p>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </Modal>
    </div>
  );
}
