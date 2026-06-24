"use client";

import { useEffect, useState } from "react";
import { Server, DollarSign } from "lucide-react";
import { DashboardSection, KPIGrid, StatCard } from "@satelink/ui";
import { AdminComingSoon } from "@/components/admin/admin-coming-soon";

export default function AdminCommandCenterPage() {
  const [nodesOnline, setNodesOnline] = useState<number | null>(null);
  const [totalRevenue, setTotalRevenue] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/nodes?status=active&limit=1")
        .then((r) => r.json())
        .catch(() => null),
      fetch("/api/revenue")
        .then((r) => r.json())
        .catch(() => null),
    ])
      .then(([nodesData, revenueData]) => {
        setNodesOnline(nodesData?.ok ? nodesData.pagination?.total ?? 0 : null);
        setTotalRevenue(revenueData?.ok ? Number(revenueData.total) : null);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-8">
      <KPIGrid columns={2}>
        <StatCard
          label="Nodes Online"
          value={nodesOnline ?? "—"}
          icon={Server}
          loading={loading}
        />
        <StatCard
          label="Total Revenue"
          value={totalRevenue != null ? `$${totalRevenue.toFixed(2)}` : "—"}
          icon={DollarSign}
          accent
          loading={loading}
        />
      </KPIGrid>

      <DashboardSection title="Jobs & System Load">
        <AdminComingSoon feature="Job queue status and system load monitoring" />
      </DashboardSection>
    </div>
  );
}
