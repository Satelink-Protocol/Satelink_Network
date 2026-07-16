"use client";

import { useEffect, useMemo, useState } from "react";
import { Users, UserCheck, CircleDollarSign } from "lucide-react";
import {
  KPIGrid,
  StatCard,
  DashboardSection,
  DataTable,
  StatusBadge,
  Badge,
  Input,
  type DataTableColumn,
} from "@satelink/ui";
import { adminGet } from "../_lib/adminClient";

interface PayingCustomer {
  wallet: string;
  credits_usdt: number;
  total_deposited: number;
  total_spent: number;
  created_at: string | number | null;
}

interface FreeTierLead {
  ip: string;
  calls_24h: number;
  first_seen: string | null;
  last_seen: string | null;
  classification: string | null;
  status: string | null;
  converted: boolean;
}

const num = (v: unknown) => Number(v) || 0;

// Never render a full client IP — mask the last two octets.
function maskIp(ip: string): string {
  const p = ip.split(".");
  return p.length === 4 ? `${p[0]}.${p[1]}.**.**` : ip;
}

const CLASS_TONE: Record<string, string> = {
  machine: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  developer: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  scanner: "bg-red-500/15 text-red-400 border-red-500/30",
  unknown: "bg-zinc-800 text-zinc-400 border-zinc-700",
};

const payingCols: DataTableColumn<PayingCustomer>[] = [
  {
    key: "wallet",
    header: "Wallet",
    cell: (r) => (
      <span className="font-mono text-xs text-foreground select-all">
        {r.wallet ? `${r.wallet.slice(0, 10)}…${r.wallet.slice(-6)}` : "—"}
      </span>
    ),
  },
  { key: "total_deposited", header: "Deposited", align: "right", cell: (r) => <span className="font-mono text-xs text-emerald-400">${num(r.total_deposited).toFixed(4)}</span> },
  { key: "total_spent", header: "Spent", align: "right", cell: (r) => <span className="font-mono text-xs text-muted-foreground">${num(r.total_spent).toFixed(4)}</span> },
  { key: "credits_usdt", header: "Balance", align: "right", cell: (r) => <span className="font-mono text-xs text-foreground">${num(r.credits_usdt).toFixed(4)}</span> },
];

const leadCols: DataTableColumn<FreeTierLead>[] = [
  { key: "ip", header: "IP", cell: (r) => <span className="font-mono text-xs">{maskIp(r.ip)}</span> },
  {
    key: "classification",
    header: "Class",
    cell: (r) => (
      <Badge className={(CLASS_TONE[r.classification ?? "unknown"] ?? CLASS_TONE.unknown) + " text-[10px]"}>
        {r.classification ?? "unknown"}
      </Badge>
    ),
  },
  { key: "calls_24h", header: "Calls (24h)", align: "right", cell: (r) => <span className="font-mono text-xs">{num(r.calls_24h).toLocaleString()}</span> },
  {
    key: "status",
    header: "Stage",
    cell: (r) => <span className="text-xs text-muted-foreground">{r.status ?? "—"}</span>,
  },
  {
    key: "converted",
    header: "Converted",
    cell: (r) => <StatusBadge status={r.converted ? "active" : "neutral"} label={r.converted ? "YES" : "no"} />,
  },
];

export default function AdminUsersPage() {
  const [paying, setPaying] = useState<PayingCustomer[] | null>(null);
  const [leads, setLeads] = useState<FreeTierLead[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    adminGet<{ paying: PayingCustomer[]; free_tier: FreeTierLead[] }>("customers/list")
      .then((d) => {
        setPaying(d?.paying ?? []);
        setLeads(d?.free_tier ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  const filteredLeads = useMemo(() => {
    if (!leads) return leads;
    const s = search.toLowerCase();
    if (!s) return leads;
    return leads.filter(
      (l) => l.ip.toLowerCase().includes(s) || (l.classification ?? "").toLowerCase().includes(s) || (l.status ?? "").toLowerCase().includes(s)
    );
  }, [leads, search]);

  const convertedCount = leads?.filter((l) => l.converted).length ?? 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <KPIGrid columns={3}>
        <StatCard label="Paying Accounts" value={paying != null ? String(paying.length) : "—"} caption="Wallets with an on-chain deposit" icon={CircleDollarSign} loading={loading} accent={(paying?.length ?? 0) > 0} />
        <StatCard label="Active Free-Tier Leads" value={leads != null ? String(leads.length) : "—"} caption="Identities seen in the last 24h" icon={Users} loading={loading} />
        <StatCard label="Converted Leads" value={String(convertedCount)} caption="Advanced to deposited/paid" icon={UserCheck} loading={loading} accent={convertedCount > 0} />
      </KPIGrid>

      <DashboardSection title="Paying Accounts" description="Accounts in api_credits with a USDT deposit" flush>
        <DataTable
          columns={payingCols}
          rows={paying}
          rowKey={(r) => r.wallet}
          loading={loading}
          emptyTitle="No paying accounts"
          emptyDescription="No account has deposited USDT yet."
        />
      </DashboardSection>

      <DashboardSection
        title="Active Free-Tier Leads"
        description="Live gateway identities from developer_intel (conversion pipeline)"
        actions={
          <Input
            placeholder="Search IP / class / stage…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56 font-mono text-xs"
          />
        }
        flush
      >
        <DataTable
          columns={leadCols}
          rows={filteredLeads}
          rowKey={(r) => r.ip}
          loading={loading}
          emptyTitle="No active leads"
          emptyDescription={search ? "No leads match your search." : "No free-tier identities recorded calls in the last 24h."}
        />
      </DashboardSection>
    </div>
  );
}
