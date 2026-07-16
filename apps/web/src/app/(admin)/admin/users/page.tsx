"use client";

import { useState } from "react";
import { Users, UserPlus, Key, Mail, ShieldAlert, UserCheck } from "lucide-react";
import {
  Button,
  KPIGrid,
  StatCard,
  DashboardSection,
  DataTable,
  StatusBadge,
  Badge,
  Input,
} from "@satelink/ui";
import { SampleDataBanner } from "../_components/DataScope";

interface UserRecord {
  id: string;
  email: string;
  role: "admin_super" | "admin_ops" | "developer" | "node_operator";
  keyCount: number;
  walletAddress: string;
  status: "active" | "suspended";
  lastActive: string;
}

const INITIAL_USERS: UserRecord[] = [
  { id: "USR-001", email: "pradeep@satelink.network", role: "admin_super", keyCount: 4, walletAddress: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e", status: "active", lastActive: "Active now" },
  { id: "USR-002", email: "alex@satelink.network", role: "admin_ops", keyCount: 2, walletAddress: "0x35Cc6634C0532925a3b844Bc454e4438f44e742d", status: "active", lastActive: "12 mins ago" },
  { id: "USR-003", email: "corp_indexer@polygon.io", role: "developer", keyCount: 5, walletAddress: "0xCc6634C0532925a3b844Bc454e4438f44e742d35", status: "active", lastActive: "1 hour ago" },
  { id: "USR-004", email: "validator_host_44@gmail.com", role: "node_operator", keyCount: 1, walletAddress: "0x844Bc454e4438f44e742d35Cc6634C0532925a3b", status: "active", lastActive: "1 day ago" },
  { id: "USR-005", email: "crawler_tester@spam.com", role: "developer", keyCount: 10, walletAddress: "0x532925a3b844Bc454e4438f44e742d35Cc6634C0", status: "suspended", lastActive: "5 days ago" },
];

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRecord[]>(INITIAL_USERS);
  const [search, setSearch] = useState("");
  const [acting, setActing] = useState<string | null>(null);

  const toggleUserStatus = (id: string, currentStatus: UserRecord["status"]) => {
    setActing(id);
    setTimeout(() => {
      setUsers((prev) =>
        prev.map((u) => (u.id === id ? { ...u, status: currentStatus === "active" ? "suspended" : "active" } : u))
      );
      setActing(null);
    }, 300);
  };

  const filteredUsers = users.filter((u) => {
    return (
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.role.toLowerCase().includes(search.toLowerCase()) ||
      u.walletAddress.toLowerCase().includes(search.toLowerCase())
    );
  });

  const roleBadge = (role: UserRecord["role"]) => {
    return {
      admin_super: "bg-red-500/15 text-red-400 border-red-500/30 font-mono",
      admin_ops: "bg-orange-500/15 text-orange-400 border-orange-500/30 font-mono",
      developer: "bg-blue-500/15 text-blue-400 border-blue-500/30 font-mono",
      node_operator: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30 font-mono",
    }[role];
  };

  const cols = [
    {
      key: "email",
      header: "User Identity",
      cell: (r: UserRecord) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold text-xs text-foreground flex items-center gap-1">
            <Mail className="h-3 w-3 text-muted-foreground" /> {r.email}
          </span>
          <span className="text-[10px] text-muted-foreground font-mono">ID: {r.id}</span>
        </div>
      ),
    },
    {
      key: "role",
      header: "Access Role",
      cell: (r: UserRecord) => (
        <Badge className={roleBadge(r.role) + " text-[10px]"}>
          {r.role.toUpperCase()}
        </Badge>
      ),
    },
    {
      key: "keyCount",
      header: "API Keys",
      cell: (r: UserRecord) => (
        <span className="text-xs text-foreground font-mono flex items-center gap-1">
          <Key className="h-3.5 w-3.5 text-muted-foreground" /> {r.keyCount} keys
        </span>
      ),
    },
    {
      key: "wallet",
      header: "Payout/Signer Wallet",
      cell: (r: UserRecord) => (
        <span className="font-mono text-xs text-muted-foreground select-all">
          {r.walletAddress.slice(0, 10)}…{r.walletAddress.slice(-6)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (r: UserRecord) => (
        <StatusBadge
          status={r.status === "active" ? "active" : "danger"}
          label={r.status.toUpperCase()}
        />
      ),
    },
    {
      key: "lastActive",
      header: "Last Activity",
      cell: (r: UserRecord) => <span className="text-xs text-muted-foreground">{r.lastActive}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right" as const,
      cell: (r: UserRecord) => (
        <div className="flex justify-end gap-1.5">
          <Button
            size="xs"
            variant="outline"
            onClick={() => alert(`Adjusting daily rate-limit budgets for user ${r.email}...`)}
          >
            Adjust Limits
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={acting !== null}
            onClick={() => toggleUserStatus(r.id, r.status)}
            className={r.status === "active" ? "text-red-400 hover:text-red-500" : "text-emerald-400 hover:text-emerald-500"}
          >
            {r.status === "active" ? "Suspend" : "Activate"}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <SampleDataBanner note="This user directory (accounts, wallets, key counts, suspend/activate actions) is placeholder data — the rows are hardcoded and the action buttons do not call the backend. Do not use it for decisions." />
      <KPIGrid columns={3}>
        <StatCard
          label="Total User Accounts"
          value={String(users.length)}
          caption="Registered network platform accounts"
          icon={Users}
        />
        <StatCard
          label="Active Developers"
          value={String(users.filter((u) => u.role === "developer" && u.status === "active").length)}
          caption="Consuming gateway RPC capacity"
          icon={UserCheck}
        />
        <StatCard
          label="Suspended Accounts"
          value={String(users.filter((u) => u.status === "suspended").length)}
          caption="Flagged accounts banned from network"
          icon={ShieldAlert}
          accent={users.filter((u) => u.status === "suspended").length > 0}
        />
      </KPIGrid>

      <DashboardSection
        title="User Core Directory"
        description="Search, audit, and modify access roles and gateway consumption boundaries"
        actions={
          <div className="flex gap-2">
            <Input
              placeholder="Search user profile..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56 font-mono text-xs"
            />
            <Button size="sm" onClick={() => alert("Launching invite dialogue...")}>
              <UserPlus className="h-3.5 w-3.5 mr-1" /> Add User
            </Button>
          </div>
        }
        flush
      >
        <DataTable columns={cols} rows={filteredUsers} rowKey={(r) => r.id} />
      </DashboardSection>
    </div>
  );
}
