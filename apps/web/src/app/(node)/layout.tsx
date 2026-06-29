"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DashboardShell, type ShellNavGroup, type ShellSearchItem } from "@satelink/ui";
import {
  LayoutDashboard,
  DollarSign,
  Cpu,
  Activity,
  Shield,
  Wallet,
  Server,
  Settings,
  AlertTriangle,
  Satellite,
} from "lucide-react";

// Master navigation for node.satelink.network. Each id maps to a view rendered
// by the single-page portal at /node (tabs-in-one-page), addressed via ?view=.
const NODE_NAV: ShellNavGroup[] = [
  {
    label: "Node Portal",
    items: [
      { id: "overview", icon: LayoutDashboard, label: "Overview" },
      { id: "earnings", icon: DollarSign, label: "Earnings & Rewards" },
      { id: "workloads", icon: Cpu, label: "Workloads" },
      { id: "performance", icon: Activity, label: "Performance" },
      { id: "reputation", icon: Shield, label: "Reputation" },
      { id: "withdrawals", icon: Wallet, label: "Withdrawals" },
      { id: "capacity", icon: Server, label: "Capacity" },
      { id: "config", icon: Settings, label: "Configuration" },
      { id: "alerts", icon: AlertTriangle, label: "Alerts" },
    ],
  },
];

const SEARCH_ITEMS: ShellSearchItem[] = NODE_NAV[0].items.map((i) => ({
  id: i.id,
  label: i.label,
  icon: i.icon,
  group: "Node Portal",
}));

function NodeShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const params = useSearchParams();
  const view = params.get("view") || "overview";

  const go = (id: string) =>
    router.push(id === "overview" ? "/node" : `/node?view=${id}`);

  const activeLabel =
    NODE_NAV[0].items.find((i) => i.id === view)?.label ?? "Overview";

  return (
    <DashboardShell
      brand={{ name: "Satelink Node", sublabel: "Operator Portal", logo: Satellite }}
      nav={NODE_NAV}
      activeId={view}
      onNavigate={go}
      breadcrumb={["Satelink", "Node", activeLabel]}
      title="Node Operator Portal"
      subtitle="Am I online? Am I earning? How do I earn more?"
      search={{
        items: SEARCH_ITEMS,
        onSelect: go,
        placeholder: "Search node portal…",
      }}
    >
      {children}
    </DashboardShell>
  );
}

export default function NodeLayout({ children }: { children: React.ReactNode }) {
  // useSearchParams must sit inside a Suspense boundary so statically-rendered
  // sibling routes under (node) (setup, earnings, claim) keep building.
  return (
    <Suspense fallback={null}>
      <NodeShell>{children}</NodeShell>
    </Suspense>
  );
}
