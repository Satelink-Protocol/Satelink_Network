"use client";

import useSWR from "swr";
import { Activity, Server, LayoutDashboard, DollarSign, CheckCircle2, Zap, Clock } from "lucide-react";
import api from "@/lib/api";

interface NetworkStats {
    total_nodes?: number;
    active_nodes?: number;
    flagged_nodes?: number;
    total_revenue?: number;
    revenue_24h?: number;
    ops_24h?: number;
    epoch_id?: number;
    epoch_status?: string;
    network_health?: string;
    health_pct?: number;
    node_types?: { node_type: string; count: number }[];
}

const fetcher = (url: string) => api.get(url).then((res) => res.data);

export function NetworkOverview() {
    const { data: stats, error, isLoading } = useSWR<NetworkStats>('/dashboard-api/network/overview', fetcher, {
        refreshInterval: 30000,
        revalidateOnFocus: false
    });

    if (error) {
        return (
            <div className="p-6 rounded-2xl border border-[#EF4444]/30 bg-[#EF4444]/10 text-[#EF4444] flex items-center gap-3">
                <Activity className="h-5 w-5" />
                <span>Failed to load network statistics. Check your connection or the backend status.</span>
            </div>
        );
    }

    const metrics = [
        {
            title: "Total Nodes",
            value: stats?.total_nodes?.toLocaleString() ?? "---",
            icon: Server,
            color: "text-[#3B82F6]",
            bg: "bg-[#3B82F6]/10"
        },
        {
            title: "Active Nodes",
            value: stats?.active_nodes?.toLocaleString() ?? "---",
            icon: Server,
            color: "text-[#22C55E]",
            bg: "bg-[#22C55E]/10"
        },
        {
            title: "Total Revenue (USDT)",
            value: stats?.total_revenue !== undefined ? `$${stats.total_revenue.toLocaleString()}` : "---",
            icon: DollarSign,
            color: "text-yellow-500",
            bg: "bg-yellow-500/10"
        },
        {
            title: "Tasks (24h)",
            value: stats?.ops_24h?.toLocaleString() ?? "---",
            icon: Zap,
            color: "text-[#3B82F6]",
            bg: "bg-[#3B82F6]/10"
        },
        {
            title: "Health %",
            value: stats?.health_pct !== undefined ? `${stats.health_pct}%` : "---",
            icon: CheckCircle2,
            color: "text-[#22C55E]",
            bg: "bg-[#22C55E]/10"
        },
        {
            title: "Current Epoch",
            value: stats?.epoch_id?.toLocaleString() ?? "---",
            icon: Clock,
            color: "text-zinc-400",
            bg: "bg-zinc-800"
        }
    ];

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {metrics.map((metric, idx) => {
                const Icon = metric.icon;
                return (
                    <div key={idx} className="p-5 rounded-2xl border border-[#262626] bg-[#1A1A0A] flex flex-col gap-3 relative overflow-hidden group">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-zinc-400">{metric.title}</span>
                            <div className={`p-2 rounded-xl ${metric.bg} ${metric.color}`}>
                                <Icon className="h-4 w-4" />
                            </div>
                        </div>
                        <div className="text-2xl font-bold text-white font-mono flex items-center gap-2">
                            {isLoading ? (
                                <div className="h-8 w-24 bg-zinc-800 animate-pulse rounded-lg" />
                            ) : (
                                metric.value
                            )}
                        </div>
                        {/* Interactive subtle hover effect representing "live" status */}
                        <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-transparent to-white/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                    </div>
                );
            })}
        </div>
    );
}
