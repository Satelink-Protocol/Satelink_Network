"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { DashboardShell, type ShellNavGroup, type ShellSearchItem } from "@satelink/ui";
import { Server, Activity, DollarSign, Wrench } from "lucide-react";

const NAV: ShellNavGroup[] = [
  {
    label: "Node Operations",
    items: [
      { id: "node", icon: Server, label: "Dashboard" },
      { id: "node/earnings", icon: Activity, label: "Earnings" },
      { id: "node/claim", icon: DollarSign, label: "Claim Rewards" },
      { id: "node/setup", icon: Wrench, label: "Setup" },
    ],
  },
];

const SEARCH_ITEMS: ShellSearchItem[] = [
  { id: "node", label: "Dashboard", icon: Server, group: "Node Operations" },
  { id: "node/earnings", label: "Earnings", icon: Activity, group: "Node Operations" },
  { id: "node/claim", label: "Claim Rewards", icon: DollarSign, group: "Node Operations" },
  { id: "node/setup", label: "Setup", icon: Wrench, group: "Node Operations" },
];

export default function NodeLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("satelink_token");
    if (!token) {
      router.push("/login");
    } else {
      setAuthorized(true);
    }
  }, [router]);

  if (!authorized) return null;

  const activeId =
    NAV.flatMap((g) => g.items).find((i) => pathname?.includes(`/${i.id}`))?.id ??
    "node";

  return (
    <DashboardShell
      brand={{ name: "Satelink OS", sublabel: "Node Operator" }}
      nav={NAV}
      activeId={activeId}
      onNavigate={(id) => router.push(`/${id}`)}
      breadcrumb={["Satelink", "Node"]}
      title="Node Operator"
      subtitle="Manage your decentralized infrastructure"
      search={{ items: SEARCH_ITEMS, onSelect: (id) => router.push(`/${id}`), placeholder: "Search..." }}
    >
      {children}
    </DashboardShell>
  );
}
