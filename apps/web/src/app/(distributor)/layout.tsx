"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { DashboardShell, type ShellNavGroup, type ShellSearchItem } from "@satelink/ui";
import { LineChart, Users } from "lucide-react";

const NAV: ShellNavGroup[] = [
  {
    label: "Distributor",
    items: [
      { id: "distributor", icon: LineChart, label: "Performance" },
      { id: "distributor/referrals", icon: Users, label: "Referrals" },
    ],
  },
];

const SEARCH_ITEMS: ShellSearchItem[] = [
  { id: "distributor", label: "Performance", icon: LineChart, group: "Distributor" },
  { id: "distributor/referrals", label: "Referrals", icon: Users, group: "Distributor" },
];

export default function DistributorLayout({ children }: { children: React.ReactNode }) {
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
    "distributor";

  return (
    <DashboardShell
      brand={{ name: "Satelink OS", sublabel: "Distributor" }}
      nav={NAV}
      activeId={activeId}
      onNavigate={(id) => router.push(`/${id}`)}
      breadcrumb={["Satelink", "Distributor"]}
      title="Distributor Portal"
      subtitle="Manage leads and network growth"
      search={{ items: SEARCH_ITEMS, onSelect: (id) => router.push(`/${id}`), placeholder: "Search..." }}
    >
      {children}
    </DashboardShell>
  );
}
