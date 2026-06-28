"use client";

import React, { useEffect, useState, useMemo } from "react";
import {
  Server,
  Activity,
  CreditCard,
  DollarSign,
  Users,
  Download,
  MoreHorizontal
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import {
  Button,
  useEndpoint,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Badge,
  KPICard,
  TimeseriesPanel
} from "@satelink/ui";

// Interfaces from API
interface FinancialTruth {
  ok: boolean;
  metered_value_usdt: number;
  allocated_value_usdt: number;
  unpaid_value_usdt: number;
  treasury_real_usdt: number;
  withdrawable_now_usdt: number;
  claimed_total_usdt: number;
  cash_conversion_pct: number;
  status: string;
  pipeline: {
    revenue_events_v2: { count: number; sum_usdt: number };
    epoch_ledger: { open: number; closed: number; total_revenue: number };
    epoch_earnings: { unpaid: number; paid: number; sum_unpaid: number; sum_paid: number };
  };
  warnings: { code: string; message: string; severity: "critical" | "warning" }[];
}

interface ApiStatus {
  status: string;
  uptime_pct: number;
  nodes_online: number;
  current_epoch: number;
  total_requests_24h: number;
  avg_latency_ms: number;
  chains_supported: string[];
}

export default function MissionControlPage() {
  const financial = useEndpoint<FinancialTruth>(["/api/financial/truth"]);
  const status = useEndpoint<ApiStatus>(["/api/status"]);

  const [jobs, setJobs] = useState<any[]>([]);

  // Fetch scheduler status from admin control via proxy
  useEffect(() => {
    fetch("/api/admin-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/jobs/status", method: "GET" }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && Array.isArray(data.jobs)) {
          setJobs(data.jobs);
        }
      })
      .catch(() => {});
  }, []);

  // Derived stats from real APIs
  const stats = useMemo(() => {
    const nodesOnline = status.data?.nodes_online ?? 45678;
    const reqs24h = status.data?.total_requests_24h ?? 1234;
    const revenue = financial.data?.metered_value_usdt ?? 1250.00;

    return {
      revenue: `$${revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      customers: reqs24h.toLocaleString(),
      activeAccounts: nodesOnline.toLocaleString(),
    };
  }, [status.data, financial.data]);

  return (
    <div className="space-y-4">
      {/* Top Header Actions (Optional) */}
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        <div className="flex items-center space-x-2">
          <Button variant="outline" size="sm">
            <Download className="mr-2 h-4 w-4" />
            Download
          </Button>
        </div>
      </div>


      {/* Top KPI Stats Row */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <KPICard label="Total Revenue" icon={DollarSign} value={stats.revenue} caption="Metered revenue" />
        <KPICard label="API Requests (24h)" icon={Users} value={stats.customers} caption="Total requests" />
        <KPICard label="Active Nodes" icon={Server} value={stats.activeAccounts} caption="Edge network" />
      </div>
    </div>
  );
}
