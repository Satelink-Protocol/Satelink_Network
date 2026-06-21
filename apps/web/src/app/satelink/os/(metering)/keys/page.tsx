"use client";

import { useState, useEffect, useCallback } from "react";
import { KeyRound, Wallet, Send, ShieldCheck } from "lucide-react";
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
  const { keys, addKey, removeKey, nameOf } = useApiKeys();
  const [rows, setRows] = useState<KeyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [revealKey, setRevealKey] = useState<string | null>(null);

  const fetchRows = useCallback(async (list: string[]) => {
    if (list.length === 0) {
      setRows([]);
      return;
    }
    setLoading(true);
    const out: KeyRow[] = [];
    for (const key of list) {
      try {
        const res = await fetch("/api/keys/usage", { headers: { "X-API-Key": key }, cache: "no-store" });
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
            lastUsed: (body.requests_today ?? 0) > 0 ? "Active today" : "—",
          });
        }
      } catch {
        /* skip unreadable key */
      }
    }
    setRows(out);
    setLoading(false);
  }, [nameOf]);

  useEffect(() => {
    fetchRows(keys);
  }, [keys, fetchRows]);

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;
    setError(null);
    setCreating(true);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: "free", wallet_address: walletAddress || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Failed to create API key");
      addKey(body.api_key, newKeyName.trim());
      setRevealKey(body.api_key);
      setNewKeyName("");
      setWalletAddress("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setCreating(false);
    }
  };

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
        <Button
          variant="ghost"
          size="xs"
          className="text-destructive hover:text-destructive"
          onClick={() => { if (confirm(`Revoke "${k.name}" from this device? The key string is removed locally.`)) removeKey(k.key); }}
        >
          Revoke
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Getting Started */}
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <CardTitle>Getting Started — 3 steps, no docs needed</CardTitle>
          <CardDescription>Everything below happens inside Satelink OS.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              { icon: KeyRound, t: "1. Create a key", d: "Generate a free-tier key below — it is shown once, copy it." },
              { icon: Wallet, t: "2. Fund account", d: "Open Deposit, send USDT to the vault, paste the tx hash." },
              { icon: Send, t: "3. Make first request", d: "Send X-API-Key on /rpc/polygon — usage & billing appear live." },
            ].map((s) => (
              <div key={s.t} className="flex items-start gap-2.5 rounded-lg border border-border bg-background/40 p-3">
                <s.icon className="mt-0.5 size-4 shrink-0 text-primary" />
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold text-foreground">{s.t}</p>
                  <p className="text-xs text-muted-foreground">{s.d}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* New-key reveal (shown once) */}
      {revealKey && (
        <Card className="border-success/40 bg-success/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-success"><ShieldCheck className="size-4" /> Key created — copy it now</CardTitle>
            <CardDescription>This is the only time the full key is shown. Store it securely.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <code className="block flex-1 break-all rounded-md border border-border bg-background/60 px-3 py-2 font-mono text-xs text-foreground">{revealKey}</code>
            <CopyButton value={revealKey} size="sm" variant="secondary" label="Copy key" />
            <Button size="sm" variant="ghost" onClick={() => setRevealKey(null)}>Dismiss</Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 items-start">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>API Keys</CardTitle>
            <CardDescription>Keys authorized to spend gateway billing credits.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Input placeholder="Key label, e.g. Production Gateway" value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} className="font-mono text-xs" />
              <Input placeholder="Funding wallet address (optional)" value={walletAddress} onChange={(e) => setWalletAddress(e.target.value)} className="font-mono text-xs" />
            </div>
            <Button onClick={handleCreateKey} disabled={creating || !newKeyName.trim()} size="sm">
              {creating ? "Generating…" : "Create Free-Tier Key"}
            </Button>
            {error && <p className="text-xs text-destructive">{error}</p>}

            <AsyncBoundary
              loading={loading && rows.length === 0}
              isEmpty={!loading && rows.length === 0}
              emptyTitle="No API keys yet"
              emptyDescription="Create your first key above — it takes one click and includes a free tier."
              emptyAction={<span className="text-[11px] text-muted-foreground">Next: fund credits on the Deposit page.</span>}
            >
              <DataTable columns={columns} rows={rows} rowKey={(k) => k.key} />
            </AsyncBoundary>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Make your first request</CardTitle>
            <CardDescription>Copy, paste your key, run.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <pre className="overflow-x-auto rounded-md border border-border bg-background/60 p-3 pr-12 font-mono text-[10px] leading-relaxed text-muted-foreground">{`curl -X POST https://rpc.satelink.network/rpc/polygon \\
  -H "X-API-Key: ${keys[0] || "sat_live_..."}" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`}</pre>
              <div className="absolute right-2 top-2">
                <CopyButton
                  value={`curl -X POST https://rpc.satelink.network/rpc/polygon -H "X-API-Key: ${keys[0] || "sat_live_..."}" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`}
                  size="icon"
                  variant="secondary"
                />
              </div>
            </div>
            <ul className="list-inside list-disc space-y-1.5 text-[11px] text-muted-foreground">
              <li>Free tier: {(rows[0]?.limit ?? 500).toLocaleString()} calls/day. Beyond that, requests bill USDT credits.</li>
              <li>Out of credits → request returns <Badge variant="warning" className="px-1 py-0">402</Badge>. Top up on Deposit.</li>
              <li>Never expose keys in client-side code.</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
