"use client";

import React, { useEffect, useState, useRef } from 'react';


import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@satelink/ui';
import { Badge } from '@satelink/ui';

import {
    Activity, Signal, Zap, Users, Wifi, Terminal,
    AlertCircle, Upload, Cpu, Clock, DollarSign, ShieldAlert,
    Loader2
} from 'lucide-react';
import {
    AreaChart, Area, ResponsiveContainer, Tooltip,
    CartesianGrid, XAxis, YAxis
} from 'recharts';
import { motion } from 'framer-motion';
const EpochCountdown = () => <span>Countdown</span>;
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "https://rpc.satelink.network";
const getAuthHeaders = () => {
  const token = typeof window !== "undefined" ? localStorage.getItem("satelink_token") : "";
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
};
const api = {
  get: async (path: string) => fetch(`${API_BASE}${path}`, { headers: getAuthHeaders() }).then(async r => ({ data: await r.json(), status: r.status, ok: r.ok })),
  post: async (path: string, body?: any) => fetch(`${API_BASE}${path}`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(body) }).then(async r => ({ data: await r.json(), status: r.status, ok: r.ok })),
  delete: async (path: string) => fetch(`${API_BASE}${path}`, { method: 'DELETE', headers: getAuthHeaders() }).then(async r => ({ data: await r.json(), status: r.status, ok: r.ok }))
};


export default function NodeDashboard() {
    const user = typeof window !== 'undefined' ? { id: 'mock' } : null;
    const lastEvent: any = null; // useSSE('/stream/node', ['heartbeat', 'log']);
    const [loading, setLoading] = useState(true);
    const [nodeStatus, setNodeStatus] = useState<any>({
        online: false, uptime: '--', peers: 0, bandwidth: '0',
        earnings: 0, latency: 0, cpu: 0, lastPing: Date.now(),
        reserveLocked: '0.00', totalEarned: '0.00', claimable: '0.00',
        totalWithdrawn: '0.00'
    });
    const [logs, setLogs] = useState<string[]>([]);
    const [telemetry, setTelemetry] = useState<any[]>([]);
    const logRef = useRef<HTMLDivElement>(null);

    // Fetch initial data from /node/stats
    useEffect(() => {
        const fetchStats = async () => {
            try {
                const res = await api.get('/node/stats');
                if (res.data.ok) {
                    const { stats, earnings, withdrawals, logs: apiLogs } = res.data;
                    setNodeStatus((prev: any) => ({
                        ...prev,
                        online: stats.active,
                        lastPing: stats.lastHeartbeat ? stats.lastHeartbeat * 1000 : Date.now(),
                        totalEarned: stats.totalEarned,
                        claimable: stats.claimable,
                        totalWithdrawn: stats.totalWithdrawn,
                        earnings: parseFloat(stats.totalEarned) || 0,
                    }));

                    // Build uptime display from uptime array
                    if (stats.uptime?.length > 0) {
                        const avgUptime = stats.uptime.reduce((sum: number, u: any) => sum + (u.uptime_pct || 0), 0) / stats.uptime.length;
                        setNodeStatus((prev: any) => ({ ...prev, uptime: `${avgUptime.toFixed(1)}%` }));
                    }

                    // Map earnings to telemetry chart data
                    if (earnings?.length > 0) {
                        const chartData = earnings.map((e: any) => ({
                            t: `E${e.epoch_id}`,
                            earned: e.amount_usdt || 0,
                        })).reverse();
                        setTelemetry(chartData);
                    }

                    // Map API logs
                    if (apiLogs?.length > 0) {
                        setLogs(apiLogs.map((l: any) => `[${l.timestamp}] ${l.message}`));
                    }
                }
            } catch (err) {
                console.error('Failed to fetch node stats:', err);
                setLogs(prev => [...prev, `[ERR] Failed to load stats from server`]);
            } finally {
                setLoading(false);
            }
        };
        fetchStats();
    }, []);

    // Handle real-time SSE updates
    useEffect(() => {
        api.get('/node-api/status').then(res => {
            if (res.data?.ok) {
                const { status, telemetry: tele, logs: apiLogs } = res.data;
                if (status) {
                    setNodeStatus((p: any) => ({
                        ...p,
                        online: status.online ?? p.online,
                        uptime: status.uptime ?? p.uptime,
                        earnings: status.earnings ?? p.earnings,
                        lastPing: status.lastPing ?? p.lastPing,
                    }));
                }
                if (tele?.length) setTelemetry(tele);
                if (apiLogs?.length) setLogs(apiLogs);
            }
        }).catch(() => { /* keep mock defaults on error */ });
    }, []);

    useEffect(() => {
        if (!lastEvent) return;
        if (lastEvent.type === 'heartbeat') {
            setNodeStatus((p: any) => ({ ...p, ...lastEvent.data, lastPing: Date.now(), online: true }));
        }
        if (lastEvent.type === 'log') {
            setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${lastEvent.data.message}`].slice(-50));
            setTimeout(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }), 50);
        }
    }, [lastEvent]);

    const metrics = [
        { label: 'Uptime', value: nodeStatus.uptime, icon: Clock, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
        { label: 'Total Earned', value: `$${nodeStatus.totalEarned}`, icon: DollarSign, color: 'text-amber-400', bg: 'bg-amber-500/10' },
        { label: 'Claimable', value: `$${nodeStatus.claimable}`, icon: Zap, color: 'text-violet-400', bg: 'bg-violet-500/10' },
        { label: 'Withdrawn', value: `$${nodeStatus.totalWithdrawn}`, icon: Upload, color: 'text-blue-400', bg: 'bg-blue-500/10' },
    ];

    if (loading) {
        return (
            <div className="flex items-center justify-center h-[60vh]">
                <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
            </div>
        );
    }

    return (
        <div className="space-y-6 p-4 sm:p-6 lg:p-8 max-w-[1440px] mx-auto fade-in">
            {/* Hero Status Banner */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className="relative overflow-hidden rounded-xl border border-zinc-800/60 bg-zinc-900/80 p-5 sm:p-6 glow-shadow">
                <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-blue-500/5 to-transparent rounded-bl-full" />
                <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <div className="relative">
                            <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${nodeStatus.online ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-red-500/10 border border-red-500/30'}`}>
                                <Activity className={`w-6 h-6 ${nodeStatus.online ? 'text-emerald-400' : 'text-red-400'}`} />
                            </div>
                            <span className={`absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-zinc-900 ${nodeStatus.online ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
                        </div>
                        <div>
                            <h1 className="text-xl sm:text-2xl font-bold text-zinc-50">Node Status</h1>
                            <div className="flex items-center gap-2 mt-1">
                                <Badge className={`text-[10px] ${nodeStatus.online ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-red-500/15 text-red-400 border-red-500/30'}`}>
                                    {nodeStatus.online ? '● ONLINE' : '● OFFLINE'}
                                </Badge>
                                <span className="text-xs text-zinc-600">
                                    Last ping: {Math.round((Date.now() - nodeStatus.lastPing) / 1000)}s ago
                                </span>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="text-right hidden sm:block">
                            <span className="text-xs text-zinc-500 block">Latency</span>
                            <span className="text-lg font-bold text-zinc-200">{nodeStatus.latency || '--'}ms</span>
                        </div>
                        <div className="w-px h-8 bg-zinc-800 hidden sm:block" />
                        <div className="text-right hidden sm:block">
                            <span className="text-xs text-zinc-500 block">CPU Load</span>
                            <span className="text-lg font-bold text-zinc-200">{nodeStatus.cpu || '--'}%</span>
                        </div>
                    </div>
                </div>
            </motion.div>

            {/* Metric Strip */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {metrics.map((m, i) => (
                    <Card key={i} className="bg-zinc-900/80 border-zinc-800/60 glow-shadow hover:border-zinc-700/80 transition-all duration-300">
                        <CardContent className="p-4">
                            <div className="flex items-center gap-3">
                                <div className={`w-9 h-9 rounded-lg ${m.bg} flex items-center justify-center`}>
                                    <m.icon className={`w-4 h-4 ${m.color}`} />
                                </div>
                                <div>
                                    <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">{m.label}</p>
                                    <p className="text-lg font-bold text-zinc-100 mt-0.5">{m.value}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Earnings Chart */}
            <Card className="bg-zinc-900/80 border-zinc-800/60 glow-shadow">
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold text-zinc-300">Earnings by Epoch</CardTitle>
                    <CardDescription className="text-xs text-zinc-600">USDT earned per epoch</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="h-[200px] sm:h-[280px]">
                        {telemetry.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={telemetry}>
                                    <defs>
                                        <linearGradient id="earnGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.25} />
                                            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                                    <XAxis dataKey="t" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={{ stroke: '#27272a' }} />
                                    <YAxis tick={{ fill: '#71717a', fontSize: 11 }} axisLine={{ stroke: '#27272a' }} />
                                    <Tooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: '8px', color: '#fafafa', fontSize: '12px' }} />
                                    <Area type="monotone" dataKey="earned" stroke="#3b82f6" fill="url(#earnGrad)" strokeWidth={2} name="USDT Earned" />
                                </AreaChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
                                No earnings data yet
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Console */}
            <Card className="bg-zinc-900/80 border-zinc-800/60 glow-shadow">
                <CardHeader className="pb-2 border-b border-zinc-800/40">
                    <div className="flex items-center gap-2">
                        <Terminal className="w-4 h-4 text-emerald-400" />
                        <CardTitle className="text-sm font-semibold text-zinc-300">Activity Log</CardTitle>
                        <span className="ml-auto text-[10px] text-zinc-600 font-mono">{logs.length} entries</span>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <div ref={logRef} className="h-[180px] sm:h-[220px] overflow-y-auto scrollbar-thin p-4 font-mono text-xs">
                        {logs.length > 0 ? logs.map((log, i) => (
                            <div key={i} className={`py-1 ${log.includes('[ERR') ? 'text-red-400' : log.includes('[WARN') ? 'text-amber-400' : 'text-zinc-400'}`}>
                                <span className="text-zinc-600 mr-2">{String(i + 1).padStart(3, '0')}</span>{log}
                            </div>
                        )) : (
                            <div className="text-zinc-600 text-center py-8">No activity yet. Events will appear here in real-time.</div>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
