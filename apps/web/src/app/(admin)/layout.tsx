"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  DollarSign,
  Receipt,
  Server,
  Users,
  BookOpen,
  Shield,
  ScrollText,
  Settings,
  FlaskConical,
  AlertTriangle,
  Trophy,
  Satellite,
  Radar,
} from "lucide-react";
import { DashboardShell, type ShellNavGroup } from "@satelink/ui";

const ALLOWED_ROLES = ["admin_super", "admin_ops", "admin_readonly"];

const NAV: ShellNavGroup[] = [
  {
    label: "Overview",
    items: [{ id: "admin", icon: LayoutDashboard, label: "Command Center" }],
  },
  {
    label: "Revenue",
    items: [
      { id: "admin/revenue", icon: DollarSign, label: "Revenue" },
      { id: "admin/revenue/events", icon: Receipt, label: "Revenue Events" },
    ],
  },
  {
    label: "Network",
    items: [
      { id: "admin/nodes", icon: Server, label: "Nodes" },
      { id: "admin/users", icon: Users, label: "Users" },
      { id: "admin/ledger", icon: BookOpen, label: "Ledger" },
    ],
  },
  {
    label: "Security",
    items: [
      { id: "admin/security", icon: Shield, label: "Security Alerts" },
      { id: "admin/security/audit", icon: ScrollText, label: "Audit Log" },
      { id: "admin/abuse", icon: Radar, label: "Abuse Monitor" },
    ],
  },
  {
    label: "Operations",
    items: [
      { id: "admin/settings", icon: Settings, label: "Settings" },
      { id: "admin/diagnostics/self-tests", icon: FlaskConical, label: "Self-Tests" },
      { id: "admin/diagnostics/incidents", icon: AlertTriangle, label: "Incidents" },
      { id: "admin/rewards/epochs", icon: Trophy, label: "Reward Epochs" },
    ],
  },
];

const HEADERS: Record<string, { title: string; subtitle: string; crumb: string }> = {
  admin: { title: "Command Center", subtitle: "Platform overview", crumb: "Command Center" },
  "admin/revenue": { title: "Revenue", subtitle: "Protocol revenue summary", crumb: "Revenue" },
  "admin/revenue/events": { title: "Revenue Events", subtitle: "Individual revenue event records", crumb: "Revenue Events" },
  "admin/nodes": { title: "Nodes", subtitle: "Registered network nodes", crumb: "Nodes" },
  "admin/users": { title: "Users", subtitle: "View users and manage access roles", crumb: "Users" },
  "admin/ledger": { title: "Ledger", subtitle: "Distribution runs", crumb: "Ledger" },
  "admin/security": { title: "Security", subtitle: "Recent security alerts", crumb: "Security" },
  "admin/security/audit": { title: "Audit Log", subtitle: "Full admin action history", crumb: "Audit Log" },
  "admin/abuse": { title: "Abuse Monitor", subtitle: "Live traffic classification and abuse pattern detection", crumb: "Abuse Monitor" },
  "admin/settings": { title: "Settings", subtitle: "Feature flags and rate limits", crumb: "Settings" },
  "admin/diagnostics/self-tests": { title: "Self-Tests", subtitle: "Backend health checks", crumb: "Self-Tests" },
  "admin/diagnostics/incidents": { title: "Incidents", subtitle: "Incident bundles", crumb: "Incidents" },
  "admin/rewards/epochs": { title: "Reward Epochs", subtitle: "Manage epoch lifecycle", crumb: "Reward Epochs" },
};

function decodeRole(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.role ?? null;
  } catch {
    return null;
  }
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("satelink_token");
    const role = token ? decodeRole(token) : null;
    if (!token || !role || !ALLOWED_ROLES.includes(role)) {
      router.replace("/login");
      return;
    }
    setChecked(true);
  }, [router]);

  if (!checked) return null;

  const allIds = NAV.flatMap((g) => g.items.map((i) => i.id));
  const activeId =
    allIds
      .slice()
      .sort((a, b) => b.length - a.length)
      .find((id) => pathname === `/${id}` || pathname?.startsWith(`/${id}/`)) ?? "admin";
  const header = HEADERS[activeId] ?? HEADERS.admin;
  const navigate = (id: string) => router.push(`/${id}`);

  return (
    <DashboardShell
      brand={{ name: "Satelink Admin", sublabel: "Control Room", logo: Satellite }}
      nav={NAV}
      activeId={activeId}
      onNavigate={navigate}
      breadcrumb={["Satelink", "Admin", header.crumb]}
      title={header.title}
      subtitle={header.subtitle}
    >
      {children}
    </DashboardShell>
  );
}
