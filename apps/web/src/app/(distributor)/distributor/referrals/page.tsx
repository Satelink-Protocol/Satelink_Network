"use client";

import { useState } from "react";
import { Users, Coins, Gift, Share2, Clipboard, Check } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  KPIGrid,
  StatCard,
  DataTable,
  StatusBadge,
  Badge,
  Input,
} from "@satelink/ui";

interface ReferralRow {
  email: string;
  joinDate: string;
  cumulativeSpendUsdt: number;
  commissionEarned: number;
  status: "active" | "inactive";
}

const INITIAL_REFERRALS: ReferralRow[] = [
  { email: "dapp_builder_blue@railway.com", joinDate: "Jun 10, 2026", cumulativeSpendUsdt: 120.4500, commissionEarned: 12.0450, status: "active" },
  { email: "indie_validator@gmail.com", joinDate: "Jun 14, 2026", cumulativeSpendUsdt: 42.1000, commissionEarned: 4.2100, status: "active" },
  { email: "sandbox_dev_group@corp.io", joinDate: "Jun 20, 2026", cumulativeSpendUsdt: 0.0, commissionEarned: 0.0, status: "inactive" },
];

export default function DistributorReferralsPage() {
  const [referrals] = useState<ReferralRow[]>(INITIAL_REFERRALS);

  const cols = [
    {
      key: "email",
      header: "Referred Account",
      cell: (r: ReferralRow) => <span className="font-semibold text-xs text-foreground">{r.email}</span>,
    },
    {
      key: "joinDate",
      header: "Join Date",
      cell: (r: ReferralRow) => <span className="text-xs text-muted-foreground">{r.joinDate}</span>,
    },
    {
      key: "cumulativeSpend",
      header: "Lifetime Consumption",
      align: "right" as const,
      cell: (r: ReferralRow) => <span className="font-mono text-xs text-foreground">${r.cumulativeSpendUsdt.toFixed(4)} USDT</span>,
    },
    {
      key: "commission",
      header: "Earned Commission (10%)",
      align: "right" as const,
      cell: (r: ReferralRow) => <span className="font-mono text-xs text-emerald-400 font-semibold">${r.commissionEarned.toFixed(4)} USDT</span>,
    },
    {
      key: "status",
      header: "Activity State",
      cell: (r: ReferralRow) => (
        <StatusBadge status={r.status === "active" ? "active" : "neutral"} label={r.status?.toUpperCase() ?? ''} />
      ),
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in max-w-6xl mx-auto py-6 px-4">
      <DashboardSection title="Commissions & Referral Registry" description="Detailed breakdowns of commissions generated from your invites" flush>
        <DataTable columns={cols} rows={referrals} rowKey={(r) => r.email} />
      </DashboardSection>
    </div>
  );
}
