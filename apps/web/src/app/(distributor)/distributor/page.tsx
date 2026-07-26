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

export default function DistributorPage() {
  const [referrals] = useState<ReferralRow[]>(INITIAL_REFERRALS);
  const [copied, setCopied] = useState(false);
  const [inviteUrl] = useState("https://satelink.network/join?ref=dist_981a");
  const [claiming, setClaiming] = useState(false);
  const [claimableBalance, setClaimableBalance] = useState(16.255);

  const copyLink = () => {
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const executeClaim = () => {
    setClaiming(true);
    setTimeout(() => {
      setClaiming(false);
      alert(`Claim request for $${claimableBalance.toFixed(3)} USDT successfully submitted!`);
      setClaimableBalance(0);
    }, 1200);
  };

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

  const totalEarned = referrals.reduce((sum, r) => sum + r.commissionEarned, 0);

  return (
    <div className="space-y-6 animate-fade-in max-w-6xl mx-auto py-6 px-4">
      <div className="flex justify-between items-center pb-4 border-b border-border">
        <div>
          <h1 className="text-xl font-bold text-foreground">Distributor Dashboard</h1>
          <p className="text-xs text-muted-foreground">Monitor referrals, commissions, and payout schedules</p>
        </div>
      </div>

      <KPIGrid columns={4}>
        <StatCard label="Total Referrals" value={String(referrals.length)} icon={Users} accent />
        <StatCard label="Commission Rate" value="10%" icon={Gift} />
        <StatCard label="Commissions Earned" value={`$${totalEarned.toFixed(3)} USDT`} icon={Coins} accent />
        <StatCard label="Claimable Balance" value={`$${claimableBalance.toFixed(3)} USDT`} icon={Coins} accent={claimableBalance > 0} />
      </KPIGrid>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2">
          <DashboardSection title="Referral Registry" description="Accounts referred via your link" flush>
            <DataTable columns={cols} rows={referrals} rowKey={(r) => r.email} />
          </DashboardSection>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Invite Links</CardTitle>
              <CardDescription>Share this unique URL to earn commissions.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input value={inviteUrl} readOnly className="font-mono text-xs flex-1 select-all" />
                <Button size="sm" onClick={copyLink}>
                  {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Clipboard className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">Referrers receive 10% of all credits billed by referred accounts.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Claim Payout</CardTitle>
              <CardDescription>Withdraw claimable commissions to your EVM wallet.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button size="sm" className="w-full" onClick={executeClaim} disabled={claiming || claimableBalance === 0}>
                {claiming ? "Submitting Payout..." : "Withdraw Commissions"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
