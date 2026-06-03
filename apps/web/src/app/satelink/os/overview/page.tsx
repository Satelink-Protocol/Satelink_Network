'use client';
import { useState, useEffect, useRef } from 'react';
import useSWR from 'swr';
import { useDashboardFilters } from '@/lib/stores/dashboard-filters';
import { FilterBar } from '@/components/satelink/filter-bar';
import api from '@/lib/api';

const fetcher = (url: string) => api.get(url).then(r => r.data);

function Skeleton({ w = 'w-full', h = 'h-4' }: { w?: string; h?: string }) {
  return (
    <div className={`${w} ${h} bg-[#1a3028]/50 rounded animate-pulse`} />
  );
}

function MetricCard({
  label, value, sub, glow, loading, trend
}: {
  label: string;
  value: string;
  sub?: string;
  glow?: boolean;
  loading?: boolean;
  trend?: 'up' | 'down' | 'flat';
}) {
  return (
    <div className={`bg-[#0c1a17] border rounded p-4 hover:border-[#285A48]
                     transition-all group ${
      glow ? 'border-[#285A48] shadow-[0_0_20px_rgba(64,138,113,0.08)]'
           : 'border-[#1a3028]'
    }`}>
      <p className="text-[9px] text-[#285A48] uppercase tracking-widest mb-2 font-semibold">
        {label}
      </p>
      {loading ? (
        <Skeleton h="h-7" w="w-2/3" />
      ) : (
        <p className={`text-[22px] font-bold font-mono leading-none ${
          glow ? 'text-[#00D1FF]' : 'text-[#B0E4CC]'
        }`}>
          {value}
          {trend === 'up' && <span className="text-[10px] text-[#408A71] ml-1">↑</span>}
        </p>
      )}
      {sub && !loading && (
        <p className="text-[10px] text-[#285A48] mt-1">{sub}</p>
      )}
    </div>
  );
}

function LiveDot({ color = '#408A71' }: { color?: string }) {
  return (
    <span className="relative flex h-2 w-2">
      <span className="animate-ping absolute inline-flex h-full w-full
                       rounded-full opacity-50"
            style={{ backgroundColor: color }} />
      <span className="relative inline-flex rounded-full h-2 w-2"
            style={{ backgroundColor: color }} />
    </span>
  );
}

function ChainRow({ chain, providers, latency, best, loading }: {
  chain: string;
  providers: number | string;
  latency: number;
  best: number;
  loading?: boolean;
}) {
  const health = latency < 50 ? '#408A71' : latency < 150 ? '#a0a030' : '#c04040';
  return (
    <div className="flex items-center justify-between py-2
                    border-b border-[#0f2318] last:border-0
                    hover:bg-[#0f2318]/50 transition-colors px-2 -mx-2 rounded">
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: health }} />
        <span className="text-[11px] text-[#B0E4CC] font-mono">{chain}</span>
      </div>
      <div className="flex items-center gap-4 text-[10px]">
        <span className="text-[#285A48]">{providers} providers</span>
        {loading ? <Skeleton w="w-10" h="h-3" /> : (
          <span className="font-mono" style={{ color: health }}>{latency}ms avg</span>
        )}
        {!loading && (
          <span className="text-[#408A71] font-mono">{best}ms best</span>
        )}
      </div>
    </div>
  );
}

function EpochRow({ epoch, revenue, nodePool, requests, status, fmt }: {
  epoch: string;
  revenue: string;
  nodePool: string;
  requests: string;
  status: string;
  fmt: (n: number) => string;
}) {
  const isPending = epoch === '#pending' || status === 'open' || status === 'pending';
  return (
    <div className={`grid grid-cols-6 gap-2 py-2 border-b border-[#0f2318]
                     last:border-0 hover:bg-[#0f2318]/30 transition-colors
                     text-[10px] font-mono ${isPending ? 'bg-[#0c2219]/30' : ''}`}>
      <div className="flex items-center gap-1.5">
        {isPending && <LiveDot />}
        <span className={isPending ? 'text-[#00D1FF]' : 'text-[#B0E4CC]'}>
          {epoch}
        </span>
      </div>
      <span className="text-[#408A71]">{fmt(parseFloat(revenue||'0'))}</span>
      <span className="text-[#285A48]">{fmt(parseFloat(nodePool||'0'))}</span>
      <span className="text-[#285A48]">
        {requests ? parseInt(requests).toLocaleString() : '—'}
      </span>
      <div className="col-span-2">
        <span className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold ${
          isPending
            ? 'bg-[#0c2219] text-[#00D1FF] border-[#285A48]'
            : 'bg-[#0f1a10] text-[#408A71] border-[#1a3028]'
        }`}>
          {isPending ? '● LIVE' : '✓ CLOSED'}
        </span>
      </div>
    </div>
  );
}

export default function OverviewPage() {
  const { fmt, revenueType } = useDashboardFilters();
  const [events, setEvents] = useState<any[]>([]);
  const [eventsPerSec, setEventsPerSec] = useState(0);
  const eventCountRef = useRef(0);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('satelink_token') : null;
    if (!token) return;
    let active = true;
    const base = process.env.NEXT_PUBLIC_API_BASE_URL || '';
    fetch(`${base}/stream/admin`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async res => {
        if (!res.ok || !res.body) return;
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        while (active) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.type === 'revenue_batch' && Array.isArray(ev.events)) {
                setEvents(prev => [...ev.events.slice(0, 5), ...prev].slice(0, 20));
                eventCountRef.current += ev.events.length;
              }
            } catch { /* skip malformed */ }
          }
        }
      })
      .catch(() => { /* silent — stream unavailable */ });
    const ticker = setInterval(() => {
      setEventsPerSec(eventCountRef.current);
      eventCountRef.current = 0;
    }, 1000);
    return () => { active = false; clearInterval(ticker); };
  }, []);

  const { data: networkStats, isLoading: loadingNetwork } = useSWR('/dashboard-api/network/overview', fetcher, { refreshInterval: 30000 });
  const { data: earnings, isLoading: loadingEarnings } = useSWR('/dashboard-api/earnings/overview', fetcher, { refreshInterval: 30000 });
  const { data: chainMetrics, isLoading: loadingChains } = useSWR('/rpc/metrics', fetcher, { refreshInterval: 30000 });

  const loading = loadingNetwork || loadingEarnings;
  const epochs = earnings?.recent_epochs || [];
  const closed = epochs.filter(e => e.id !== null && e.status !== 'open' && e.status !== 'pending');

  const displayRevenue = networkStats?.total_revenue || 0;
  const displayNodePool = earnings?.split?.node_operator || 0;
  const totalReqs = chainMetrics?.rpcGateway?.totalRequestsToday || 0;
  const avgCallsPerHour = totalReqs > 0 ? Math.round(totalReqs / 24) : 0;

  return (
    <div className="flex flex-col h-full bg-[#091413]">
      <FilterBar page="overview" />

      <div className="flex-1 overflow-auto p-5">
        {/* Status bar */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <LiveDot />
              <span className="text-[11px] text-[#408A71] font-semibold">
                SATELINK OPERATIONAL
              </span>
            </div>
            <span className="text-[#1a3028]">·</span>
            <span className="text-[10px] text-[#285A48]">
              Epoch #{closed.length > 0 ? closed.length + 1 : '0'} active
            </span>
            <span className="text-[#1a3028]">·</span>
            <span className="text-[10px] font-mono text-[#285A48]">
              {eventsPerSec > 0 ? `${eventsPerSec} events/s` : 'monitoring'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] px-2 py-0.5 rounded border
                             bg-[#0c2219] text-[#408A71] border-[#285A48]
                             font-semibold tracking-wider">
              POLYGON 137
            </span>
            <span className="text-[9px] px-2 py-0.5 rounded border
                             bg-[#1a1a0f] text-[#a0a030] border-[#3a3e18]
                             font-semibold tracking-wider">
              BETA
            </span>
          </div>
        </div>

        {/* Primary metrics — 6 columns */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
          <MetricCard
            label="Total Revenue"
            value={loading ? '...' : fmt(displayRevenue)}
            sub='metered · not collected'
            loading={loading}
          />
          <MetricCard
            label="Node Pool (50%)"
            value={loading ? '...' : fmt(displayNodePool)}
            sub='claimable by operators'
            loading={loading}
          />
          <MetricCard
            label="Total RPC Calls"
            value={loading ? '...' : totalReqs > 0 ? totalReqs.toLocaleString() : '—'}
            sub="today's requests"
            loading={loading}
          />
          <MetricCard
            label="Avg Hourly Rate"
            value={loading ? '...' : avgCallsPerHour > 0 ? `${avgCallsPerHour.toLocaleString()}/hr` : '—/hr'}
            sub="req/hr estimate"
            loading={loading}
          />
          <MetricCard
            label="Active Nodes"
            value={loading ? '...' : String(networkStats?.active_nodes || 0)}
            sub="active"
            loading={loading}
          />
          <MetricCard
            label="Epochs Tracked"
            value={loading ? '...' : String(epochs.length || 0)}
            sub="60s close interval"
            loading={loading}
          />
        </div>

        {/* Main 3-column layout */}
        <div className="grid grid-cols-12 gap-4 mb-4">

          {/* Epoch history — 7 cols */}
          <div className="col-span-12 lg:col-span-7
                          bg-[#0c1a17] border border-[#1a3028] rounded">
            <div className="flex items-center justify-between
                            px-4 py-3 border-b border-[#1a3028]">
              <div>
                <p className="text-[11px] font-semibold text-[#B0E4CC]">
                  Epoch Revenue History
                </p>
                <p className="text-[9px] text-[#285A48] mt-0.5">
                  50/30/20 split · real-time from /dashboard-api/earnings/overview
                </p>
              </div>
              <a href="https://polygonscan.com/address/0x6987921e2453f360e314e4424F6c2789F10a1CC9"
                 target="_blank"
                 rel="noopener noreferrer"
                 className="text-[9px] text-[#285A48] hover:text-[#408A71]
                            transition-colors font-mono border border-[#1a3028]
                            px-2 py-1 rounded hover:border-[#285A48]">
                ClaimsContract ↗
              </a>
            </div>

            {/* Table header */}
            <div className="grid grid-cols-6 gap-2 px-4 py-1.5
                            border-b border-[#1a3028] text-[9px]
                            text-[#285A48] uppercase tracking-widest font-semibold">
              <span>Epoch</span>
              <span>Revenue</span>
              <span>Node Pool</span>
              <span>Requests</span>
              <span className="col-span-2">Status</span>
            </div>

            <div className="px-4 py-1">
              {loading ? (
                Array.from({length:5}).map((_,i) => (
                  <div key={i} className="py-2 border-b border-[#0f2318]">
                    <Skeleton h="h-4" />
                  </div>
                ))
              ) : (
                epochs.slice(0, 8).map((e, i) => {
                  const isPending = e.id === null || e.status === 'open' || e.status === 'pending';
                  return (
                    <EpochRow key={i}
                      epoch={isPending
                        ? '#pending'
                        : `#${e.id}`}
                      revenue={String(e.total_revenue_usdt || '0')}
                      nodePool={String(e.node_pool_usdt || '0')}
                      requests={'0'} // Need endpoint
                      status={isPending ? 'open' : 'closed'}
                      fmt={fmt}
                    />
                  );
                })
              )}
            </div>
          </div>

          {/* Live events — 5 cols */}
          <div className="col-span-12 lg:col-span-5
                          bg-[#0c1a17] border border-[#1a3028] rounded">
            <div className="flex items-center justify-between
                            px-4 py-3 border-b border-[#1a3028]">
              <div className="flex items-center gap-2">
                <LiveDot color="#00D1FF" />
                <p className="text-[11px] font-semibold text-[#B0E4CC]">
                  Live Event Stream
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-mono text-[#00D1FF]">
                  {eventsPerSec}/s
                </span>
                <span className="text-[9px] px-1.5 py-0.5 rounded
                                 bg-[#091c15] text-[#00D1FF]
                                 border border-[#1a4030] font-semibold">
                  SSE
                </span>
              </div>
            </div>

            <div className="p-3 space-y-1 h-[280px] overflow-hidden">
              {events.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#408A71] animate-pulse" />
                  <p className="text-[10px] text-[#285A48]">
                    Listening for events...
                  </p>
                </div>
              ) : (
                events.map((ev, i) => (
                  <div key={i}
                       className="flex items-center justify-between
                                  py-1.5 px-2 rounded bg-[#091413]
                                  border border-[#1a3028]
                                  hover:border-[#285A48] transition-all
                                  animate-fadeIn group"
                       style={{ opacity: Math.max(0.3, 1 - i * 0.07) }}>
                    <div className="flex items-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-[#408A71]
                                       flex-shrink-0" />
                      <span className="text-[9px] text-[#285A48] font-mono">
                        {ev.type || 'revenue'} · {ev.method || 'rpc'}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono font-semibold text-[#00D1FF]">
                      +{fmt(parseFloat(ev.amount_usdt || 0))}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Chain performance grid */}
        <div className="bg-[#0c1a17] border border-[#1a3028] rounded p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[11px] font-semibold text-[#B0E4CC]">
                Chain Performance
              </p>
              <p className="text-[9px] text-[#285A48] mt-0.5">
                Live from /rpc/metrics · provider health
              </p>
            </div>
            <span className="text-[9px] text-[#285A48] font-mono">
              {chainMetrics?.uptime || chainMetrics?.uptimeSeconds
                ? `${Math.floor((chainMetrics?.uptimeSeconds || 3600) / 3600)}h uptime`
                : '1h uptime'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8">
            {loadingChains ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="py-2 border-b border-[#0f2318]">
                  <Skeleton h="h-4" />
                </div>
              ))
            ) : chainMetrics?.chains ? (
              Object.entries(chainMetrics.chains).map(([chain, data]: [string, any]) => (
                <ChainRow key={chain}
                  chain={chain}
                  providers={data.providers?.healthy || data.providers || '?'}
                  latency={data.performance?.avgLatencyMs || data.latency || 0}
                  best={data.performance?.bestLatencyMs || data.best || 0}
                  loading={false}
                />
              ))
            ) : (
              <div className="col-span-3 text-center py-4">
                <p className="text-[10px] text-[#285A48]">No chain metrics available</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
