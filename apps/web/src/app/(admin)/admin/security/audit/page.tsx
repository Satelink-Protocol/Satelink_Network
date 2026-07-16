"use client";

import { useState } from "react";
import { ScrollText, Search, Download } from "lucide-react";
import {
  Button,
  Input,
  KPIGrid,
  StatCard,
  DashboardSection,
  DataTable,
  StatusBadge,
} from "@satelink/ui";
import { SampleDataBanner } from "../../_components/DataScope";

interface AuditLog {
  id: string;
  timestamp: string;
  admin: string;
  action: string;
  details: string;
  ipAddress: string;
  status: "success" | "failed";
}

const INITIAL_LOGS: AuditLog[] = [
  { id: "AUD-109", timestamp: "06:06:58", admin: "pradeep@satelink.network", action: "SETTINGS_UPDATE", details: "Enabled Strict Shield Mode on gateway pools", ipAddress: "72.45.18.23", status: "success" },
  { id: "AUD-108", timestamp: "06:04:12", admin: "pradeep@satelink.network", action: "IP_QUARANTINE", details: "Quarantined scanner client IP subnet 192.168.**.**", ipAddress: "72.45.18.23", status: "success" },
  { id: "AUD-107", timestamp: "05:59:45", admin: "ops_scheduler", action: "MERKLE_SETTLEMENT", details: "Merkle root submitted for Epoch 489", ipAddress: "127.0.0.1 (local)", status: "success" },
  { id: "AUD-106", timestamp: "05:12:00", admin: "alex@satelink.network", action: "KEY_REVOCATION", details: "Revoked API key labels: 'Legacy Portal Dev'", ipAddress: "88.192.10.42", status: "success" },
  { id: "AUD-105", timestamp: "04:30:15", admin: "alex@satelink.network", action: "SETTINGS_UPDATE", details: "Attempted to override epoch threshold value to 0.0 USDT", ipAddress: "88.192.10.42", status: "failed" },
];

export default function AdminAuditLogPage() {
  const [logs] = useState<AuditLog[]>(INITIAL_LOGS);
  const [search, setSearch] = useState("");

  const filteredLogs = logs.filter((log) => {
    return (
      log.admin.toLowerCase().includes(search.toLowerCase()) ||
      log.action.toLowerCase().includes(search.toLowerCase()) ||
      log.details.toLowerCase().includes(search.toLowerCase())
    );
  });

  const cols = [
    {
      key: "timestamp",
      header: "Timestamp",
      cell: (r: AuditLog) => <span className="text-xs text-muted-foreground font-mono">{r.timestamp}</span>,
    },
    {
      key: "admin",
      header: "Admin User",
      cell: (r: AuditLog) => <span className="font-semibold text-xs text-foreground">{r.admin}</span>,
    },
    {
      key: "action",
      header: "Action",
      cell: (r: AuditLog) => (
        <span className="font-mono text-xs text-primary font-semibold">{r.action}</span>
      ),
    },
    {
      key: "details",
      header: "Action Details",
      cell: (r: AuditLog) => <span className="text-xs text-muted-foreground font-mono">{r.details}</span>,
    },
    {
      key: "ipAddress",
      header: "IP Address",
      cell: (r: AuditLog) => <span className="text-xs text-muted-foreground font-mono">{r.ipAddress}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (r: AuditLog) => (
        <StatusBadge
          status={r.status === "success" ? "active" : "danger"}
          label={r.status.toUpperCase()}
        />
      ),
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <SampleDataBanner note="These audit-log rows are placeholder data, not the real admin action history. A live audit feed exists at the /admin/audit-log observer endpoint but this page is not yet wired to it. Do not use it for decisions." />
      <KPIGrid columns={3}>
        <StatCard
          label="Total Audit Records"
          value={String(logs.length)}
          caption="Lifetime administrator operations logged"
          icon={ScrollText}
        />
        <StatCard
          label="Last Session User"
          value="pradeep@satelink"
          caption="Active supervisor token verified"
        />
        <StatCard
          label="Audit Integrity"
          value="SECURE"
          caption="Cryptographic blockchain hashes match local db log"
          accent
        />
      </KPIGrid>

      <DashboardSection
        title="Admin Action Audit Logs"
        description="Immutable logs of all state-mutating actions executed within the admin panel"
        actions={
          <div className="flex gap-2">
            <div className="relative">
              <Input
                placeholder="Search audit trail..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-56 font-mono text-xs"
              />
            </div>
            <Button size="sm" variant="outline" onClick={() => alert("Downloading audit logs CSV...")}>
              <Download className="h-3.5 w-3.5 mr-1" /> Export CSV
            </Button>
          </div>
        }
        flush
      >
        <DataTable columns={cols} rows={filteredLogs} rowKey={(r) => r.id} />
      </DashboardSection>
    </div>
  );
}
