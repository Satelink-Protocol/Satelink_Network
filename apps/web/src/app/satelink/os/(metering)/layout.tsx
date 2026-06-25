"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Server,
  Activity,
  Wallet,
  Receipt,
  BarChart3,
  KeyRound,
  Satellite,
  Users,
  Cpu,
  RefreshCcw,
  DollarSign,
} from "lucide-react";
import {
  DashboardShell,
  Badge,
  type ShellNavGroup,
  type ShellSearchItem,
} from "@satelink/ui";

const NAV: ShellNavGroup[] = [
  {
    label: "Platform",
    items: [
      { id: "mission-control", icon: LayoutDashboard, label: "Mission Control" },
      { id: "overview", icon: Activity, label: "System Overview" },
      { id: "nodes", icon: Server, label: "Nodes" },
      { id: "monitoring", icon: Activity, label: "Monitoring" },
      { id: "agent-fleet", icon: Cpu, label: "Paperclip Fleet" },
    ],
  },
  {
    label: "Revenue Ops",
    items: [
      { id: "customer-zero", icon: Users, label: "Customer Zero" },
      { id: "revenue-ops", icon: DollarSign, label: "Revenue Operations" },
      { id: "settlement-lifecycle", icon: RefreshCcw, label: "Settlement Lifecycle" },
    ],
  },
  {
    label: "Billing",
    items: [
      { id: "billing", icon: Receipt, label: "Billing" },
      { id: "deposit", icon: Wallet, label: "Credits & Deposits" },
      { id: "usage", icon: BarChart3, label: "Usage Metering" },
      { id: "keys", icon: KeyRound, label: "API Keys & SDK" },
    ],
  },
];

const SEARCH_ITEMS: ShellSearchItem[] = [
  { id: "mission-control", label: "Mission Control", icon: LayoutDashboard, group: "Platform" },
  { id: "overview", label: "System Overview", icon: Activity, group: "Platform" },
  { id: "nodes", label: "Nodes", icon: Server, group: "Platform" },
  { id: "monitoring", label: "Monitoring", icon: Activity, group: "Platform" },
  { id: "agent-fleet", label: "Paperclip Fleet", icon: Cpu, group: "Platform" },
  { id: "customer-zero", label: "Customer Zero Tracker", icon: Users, group: "Revenue Ops" },
  { id: "revenue-ops", label: "Revenue Operations", icon: DollarSign, group: "Revenue Ops" },
  { id: "settlement-lifecycle", label: "Settlement Lifecycle", icon: RefreshCcw, group: "Revenue Ops" },
  { id: "billing", label: "Billing", icon: Receipt, group: "Billing" },
  { id: "deposit", label: "Credits & Deposits", icon: Wallet, group: "Billing" },
  { id: "usage", label: "Usage Metering", icon: BarChart3, group: "Billing" },
  { id: "keys", label: "API Keys & SDK", icon: KeyRound, group: "Billing" },
];

const HEADERS: Record<string, { title: string; subtitle: string; crumb: string }> = {
  "mission-control": {
    title: "Mission Control",
    subtitle: "One-screen executive infrastructure overview",
    crumb: "Mission Control",
  },
  overview: {
    title: "System Overview",
    subtitle: "Observability network metrics and active usage",
    crumb: "Overview",
  },
  nodes: {
    title: "Network Nodes",
    subtitle: "Decentralized computing nodes and resource availability",
    crumb: "Nodes",
  },
  monitoring: {
    title: "Monitoring",
    subtitle: "Live platform health and embedded Grafana observability",
    crumb: "Monitoring",
  },
  "agent-fleet": {
    title: "Paperclip Fleet Control",
    subtitle: "AI Agent active worker topology and telemetry",
    crumb: "Paperclip Fleet",
  },
  "customer-zero": {
    title: "Customer Zero Tracker",
    subtitle: "Track visitor-to-settlement conversion funnel and first customer revenue",
    crumb: "Customer Zero",
  },
  "revenue-ops": {
    title: "Revenue Operations Center",
    subtitle: "Gross billing, infrastructure gas costs, and net margin tracking",
    crumb: "Revenue Operations",
  },
  "settlement-lifecycle": {
    title: "Settlement Lifecycle Center",
    subtitle: "Epoch calculations, Merkle validations, and withdrawal ledger",
    crumb: "Settlement Lifecycle",
  },
  billing: {
    title: "Billing",
    subtitle: "Balance, consumption, revenue events and credit history",
    crumb: "Billing",
  },
  deposit: {
    title: "Credits & Deposits",
    subtitle: "Fund your account and manage API billing credits",
    crumb: "Billing",
  },
  usage: {
    title: "Usage & Metering",
    subtitle: "Real-time consumption analytics and request telemetry",
    crumb: "Usage",
  },
  keys: {
    title: "API Keys & Integration",
    subtitle: "Manage security credentials and quickstart configurations",
    crumb: "Developer Keys",
  },
};

export default function SatelinkOSLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const activeId =
    NAV.flatMap((g) => g.items).find((i) => pathname?.includes(`/${i.id}`))?.id ??
    "mission-control";
  const header = HEADERS[activeId];
  const navigate = (id: string) => router.push(`/satelink/os/${id}`);

  return (
    <DashboardShell
      brand={{ name: "Satelink OS", sublabel: "Operating System", logo: Satellite }}
      nav={NAV}
      activeId={activeId}
      onNavigate={navigate}
      breadcrumb={["Satelink", "OS", header.crumb]}
      title={header.title}
      subtitle={header.subtitle}
      search={{ items: SEARCH_ITEMS, onSelect: navigate, placeholder: "Search OS…" }}
      headerRight={
        <Badge variant="success" className="hidden gap-1.5 sm:inline-flex">
          <span className="size-1.5 rounded-full bg-success" />
          Production
        </Badge>
      }
    >
      {children}
    </DashboardShell>
  );
}
