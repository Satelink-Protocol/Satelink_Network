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

  // Set up throughput data
  const chartData = useMemo(() => {
    const data = [];
    const now = Date.now();
    for (let i = 24; i >= 0; i--) {
      const timeStr = new Date(now - i * 3600000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      data.push({
        date: timeStr,
        requests: Math.floor(1500 + Math.random() * 4500 + Math.sin(i / 3) * 1500),
      });
    }
    return data;
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
      growth: "4.5%",
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
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPICard label="Total Revenue" icon={DollarSign} value={stats.revenue} caption="+20.1% from last month" />
        <KPICard label="New Customers" icon={Users} value={`+${stats.customers}`} caption="+180.1% from last month" />
        <KPICard label="Active Accounts" icon={CreditCard} value={`+${stats.activeAccounts}`} caption="+19% from last month" />
        <KPICard label="Growth Rate" icon={Activity} value={`+${stats.growth}`} caption="+201 since last hour" />
      </div>

      {/* Row 1: System Requests (Line Chart) */}
      <div className="grid gap-4 grid-cols-1">
        <TimeseriesPanel title="Customer Activity" description="Customer activity for the last 3 months">
          <ChartContainer
            config={{
              requests: {
                label: "Active Accounts",
                color: "hsl(var(--primary))",
              },
            }}
            className="h-[350px] w-full"
          >
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="fillRequests" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-requests)" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="var(--color-requests)" stopOpacity={0.0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis 
                dataKey="date" 
                tickLine={false} 
                axisLine={false} 
                tickMargin={8}
                tickFormatter={(value) => value.slice(0, 3)}
                className="text-xs text-muted-foreground"
              />
              <YAxis 
                tickLine={false} 
                axisLine={false} 
                tickMargin={8} 
                className="text-xs text-muted-foreground"
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area 
                type="monotone" 
                dataKey="requests" 
                stroke="var(--color-requests)" 
                strokeWidth={2} 
                fillOpacity={1} 
                fill="url(#fillRequests)" 
              />
            </AreaChart>
          </ChartContainer>
        </TimeseriesPanel>
      </div>

      {/* Row 2: Live Activity Log Table */}
      <div className="grid gap-4 grid-cols-1">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>18,426 Customers</CardTitle>
              <div className="text-sm text-muted-foreground mt-1">Recent customer records with plan, billing, status, and signup activity.</div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm">Export</Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Billing</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead className="text-right">Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    { name: "Sarah Parker", id: "#18425", status: "Subscribed", billing: "Paid", plan: "Enterprise", date: "30th April 2026", time: "at 10:25 AM" },
                    { name: "Michael Brown", id: "#18424", status: "Inactive", billing: "Pending", plan: "Growth", date: "29th April 2026", time: "at 10:08 AM" },
                    { name: "Emily Chen", id: "#18423", status: "Subscribed", billing: "Paid", plan: "Starter", date: "28th April 2026", time: "at 09:12 AM" },
                    { name: "James Wilson", id: "#18422", status: "Subscribed", billing: "Paid", plan: "Enterprise", date: "27th April 2026", time: "at 14:30 PM" },
                    { name: "Olivia Taylor", id: "#18421", status: "Suspended", billing: "Failed", plan: "Growth", date: "26th April 2026", time: "at 11:45 AM" },
                  ].map((customer, idx) => (
                    <TableRow key={idx}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                            <Users className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div>
                            <div className="font-medium">{customer.name}</div>
                            <div className="text-xs text-muted-foreground">{customer.id}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">{customer.status}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className={`h-2 w-2 rounded-full ${customer.billing === 'Paid' ? 'bg-green-500' : customer.billing === 'Pending' ? 'bg-yellow-500' : 'bg-red-500'}`} />
                          <span className="text-sm">{customer.billing}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">{customer.plan}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="text-sm font-medium">{customer.date}</div>
                        <div className="text-xs text-muted-foreground">{customer.time}</div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
