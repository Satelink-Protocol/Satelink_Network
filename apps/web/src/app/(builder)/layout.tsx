"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { DashboardShell, type ShellNavGroup, type ShellSearchItem } from "@satelink/ui";
import { LayoutDashboard, FolderKanban, KeyRound, BookOpen } from "lucide-react";

const NAV: ShellNavGroup[] = [
  {
    label: "Builder",
    items: [
      { id: "builder", icon: LayoutDashboard, label: "Dashboard" },
      { id: "builder/projects", icon: FolderKanban, label: "Projects" },
      { id: "builder/keys", icon: KeyRound, label: "API Keys" },
      { id: "builder/docs", icon: BookOpen, label: "Documentation" },
    ],
  },
];

const SEARCH_ITEMS: ShellSearchItem[] = [
  { id: "builder", label: "Dashboard", icon: LayoutDashboard, group: "Builder" },
  { id: "builder/projects", label: "Projects", icon: FolderKanban, group: "Builder" },
  { id: "builder/keys", label: "API Keys", icon: KeyRound, group: "Builder" },
  { id: "builder/docs", label: "Documentation", icon: BookOpen, group: "Builder" },
];

export default function BuilderLayout({ children }: { children: React.ReactNode }) {
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
    "builder";

  return (
    <DashboardShell
      brand={{ name: "Satelink OS", sublabel: "Builder" }}
      nav={NAV}
      activeId={activeId}
      onNavigate={(id) => router.push(`/${id}`)}
      breadcrumb={["Satelink", "Builder"]}
      title="Builder Portal"
      subtitle="Build on the decentralized network"
      search={{ items: SEARCH_ITEMS, onSelect: (id) => router.push(`/${id}`), placeholder: "Search..." }}
    >
      {children}
    </DashboardShell>
  );
}
