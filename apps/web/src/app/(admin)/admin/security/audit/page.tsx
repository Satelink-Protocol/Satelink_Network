"use client";

import { useEffect, useMemo, useState } from "react";
import { ScrollText } from "lucide-react";
import { Input, KPIGrid, StatCard, DashboardSection, DataTable, type DataTableColumn } from "@satelink/ui";
import { adminGet } from "../../_lib/adminClient";

interface AuditRow {
  id?: number | string;
  actor_wallet?: string | null;
  action_type?: string | null;
  target_type?: string | null;
  target_id?: string | null;
  created_at?: number | string | null;
}

function fmtTime(ts: number | string | null | undefined): string {
  if (ts == null) return "—";
  const n = Number(ts);
  if (!Number.isFinite(n)) return String(ts);
  // created_at is BIGINT epoch — seconds or ms.
  const ms = n > 1e12 ? n : n * 1000;
  return new Date(ms).toLocaleString();
}

const cols: DataTableColumn<AuditRow>[] = [
  { key: "created_at", header: "Timestamp", cell: (r) => <span className="text-xs text-muted-foreground font-mono">{fmtTime(r.created_at)}</span> },
  { key: "actor_wallet", header: "Actor", cell: (r) => <span className="font-mono text-xs text-foreground">{r.actor_wallet || "—"}</span> },
  { key: "action_type", header: "Action", cell: (r) => <span className="font-mono text-xs text-primary font-semibold">{r.action_type || "—"}</span> },
  { key: "target", header: "Target", cell: (r) => <span className="text-xs text-muted-foreground font-mono">{[r.target_type, r.target_id].filter(Boolean).join(":") || "—"}</span> },
];

export default function AdminAuditLogPage() {
  const [logs, setLogs] = useState<AuditRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    adminGet<AuditRow[]>("audit-log")
      .then((rows) => setLogs(Array.isArray(rows) ? rows : []))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!logs) return logs;
    const s = search.toLowerCase();
    if (!s) return logs;
    return logs.filter((l) =>
      [l.actor_wallet, l.action_type, l.target_type, l.target_id].some((v) => (v ?? "").toLowerCase().includes(s))
    );
  }, [logs, search]);

  return (
    <div className="space-y-6 animate-fade-in">
      <KPIGrid columns={2}>
        <StatCard label="Audit Records" value={logs != null ? String(logs.length) : "—"} caption="Most recent 100 admin actions" icon={ScrollText} loading={loading} />
        <StatCard
          label="Latest Action"
          value={logs != null && logs.length > 0 ? logs[0].action_type || "—" : "—"}
          caption={logs != null && logs.length > 0 ? fmtTime(logs[0].created_at) : "No actions logged"}
          loading={loading}
        />
      </KPIGrid>

      <DashboardSection
        title="Admin Action Audit Log"
        description="State-mutating admin actions (admin_audit_log)"
        actions={
          <Input
            placeholder="Search actor / action / target…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56 font-mono text-xs"
          />
        }
        flush
      >
        <DataTable
          columns={cols}
          rows={filtered}
          rowKey={(r, i) => String(r.id ?? `${r.created_at}-${i}`)}
          loading={loading}
          emptyTitle="No audit records"
          emptyDescription={search ? "No records match your search." : "No admin actions have been logged yet (the admin_audit_log table may not be populated)."}
        />
      </DashboardSection>
    </div>
  );
}
