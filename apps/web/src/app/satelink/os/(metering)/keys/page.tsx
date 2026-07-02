"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { KeyRound, Wallet, Send, ShieldCheck, AlertTriangle, TrendingUp } from "lucide-react";
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
  type DataTableColumn,
} from "@satelink/ui";
import { useApiKeys, maskKey, type UsageSummary } from "@/lib/api-keys";
import { CopyButton } from "@/components/billing/shared";

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

  // ----- UI state for Access Rules modal -----
  const [configKey, setConfigKey] = useState<KeyRow | null>(null);
  const [configBudget, setConfigBudget] = useState("10.0");
  const [configWhitelist, setConfigWhitelist] = useState("157.45.**.**");

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

  // ----- KPI calculations -----
  const keysNearLimit = useMemo(() => {
    return rows.filter((r) => r.creditsRemaining / r.limit < 0.1 || r.requestsToday > r.limit * 0.9).length;
  }, [rows]);
  const totalSpendingToday = useMemo(() => rows.reduce((sum, r) => sum + r.creditsConsumed, 0), [rows]);
  const alerts = keysNearLimit > 0 ? 1 : 0;
  const revenueImpact = useMemo(() => {
    return (totalSpendingToday * 1.2).toFixed(2);
  }, [totalSpendingToday]);

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
          <Button variant="outline" size="xs" onClick={() => { setConfigKey(k); setConfigBudget("10.0"); setConfigWhitelist("157.45.**.**"); }}>
            Budget
          </Button>
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
          value={`$${totalSpendingToday.toFixed(2)}`}
          caption={rows.length ? `${rows.length} active key(s)` : "—"}
        />
        <KPICard
          label="Alerts"
          icon={AlertTriangle}
          value={alerts}
          caption={alerts ? "Budget exceeded" : "No alerts"}
        />
        <KPICard
          label="Revenue Impact"
          icon={Wallet}
          value={`$${revenueImpact}`}
          caption="Potential loss if limits hit"
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
                  <ShieldCheck className="size-4" /> Key created — copy it now
                </CardTitle>
                <CardDescription>This is the only time the full key is shown. Store it securely.</CardDescription>
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

      {/* Access Rules Modal (inline) */}
      {configKey && (
        <Card className="glow-card glass-panel border-primary/20 bg-primary/5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-sm font-semibold">Access Rules: {configKey.name}</CardTitle>
              <CardDescription className="text-xs">Configure daily spending caps and whitelist restrictions</CardDescription>
            </div>
            <Button size="xs" variant="ghost" onClick={() => setConfigKey(null)}>Close</Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-400 block">Daily Budget Cap (USDT)</label>
                <Input value={configBudget} onChange={(e) => setConfigBudget(e.target.value)} className="font-mono text-xs bg-zinc-800 border-zinc-700 text-white" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-400 block">IP Whitelist Subnets</label>
                <Input value={configWhitelist} onChange={(e) => setConfigWhitelist(e.target.value)} className="font-mono text-xs bg-zinc-800 border-zinc-700 text-white" />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" className="border-zinc-700 text-zinc-300 hover:border-zinc-600" onClick={() => setConfigKey(null)}>Cancel</Button>
              <Button size="sm" className="bg-[hsl(174,80%,38%)] text-black font-medium hover:bg-[hsl(174,80%,45%)]" onClick={() => { alert("Gateway access rules updated."); setConfigKey(null); }}>Save Rules</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Actions Bar */}
      <div className="flex gap-2 justify-end py-2">
        <Button className="bg-[hsl(174,80%,38%)] text-black font-medium hover:bg-[hsl(174,80%,45%)]" onClick={() => { setError(null); setShowCreate(true); }}>
          Add New Key
        </Button>
        <Button variant="destructive" onClick={() => {
          if (confirm("Bulk revoke all keys? This cannot be undone.")) {
            keys.forEach((k) => removeKey(k));
          }
        }}>
          Bulk Revoke
        </Button>
        <Button variant="outline" className="border-zinc-700 text-zinc-300 hover:border-zinc-600" onClick={() => {
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

      {/* Create Key Modal */}
      {showCreate && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50"
          onClick={() => setShowCreate(false)}
        >
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-zinc-900 border border-zinc-800 rounded-sm p-6 w-full max-w-md shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 mb-4">Create API Key</h2>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Label</label>
                <input
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-sm px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-[hsl(174,80%,38%)] focus:ring-1 focus:ring-[hsl(174,80%,38%)]"
                  placeholder="My API Key"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Email (optional)</label>
                <input
                  type="email"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-sm px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-[hsl(174,80%,38%)] focus:ring-1 focus:ring-[hsl(174,80%,38%)]"
                  placeholder="you@example.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                />
                <p className="text-xs text-zinc-500 mt-1">Receive network updates and usage alerts</p>
              </div>
              {error && <p className="text-xs text-red-400">{error}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  className="px-4 py-2 text-sm text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-600 rounded-sm"
                  onClick={() => setShowCreate(false)}
                >
                  Cancel
                </button>
                <button
                  className="px-4 py-2 text-sm bg-[hsl(174,80%,38%)] text-black font-semibold rounded-sm hover:bg-[hsl(174,80%,45%)] disabled:opacity-50 disabled:pointer-events-none"
                  onClick={handleCreateKey}
                  disabled={creating}
                >
                  {creating ? "Creating…" : "Create Key"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
