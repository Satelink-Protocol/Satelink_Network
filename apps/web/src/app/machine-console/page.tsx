'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  KPICard,
  StatusBadge,
  Badge,
  LegacyDataTable,
  TimeRangeFilter,
  SpendThresholdFilter,
  windowParams,
  type Column,
  type TimeWindow,
  type SpendThreshold,
} from '@satelink/ui';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  CheckCircle2,
  Database,
  DollarSign,
  Gauge,
  LayoutDashboard,
  Network,
  RefreshCcw,
  Server,
  Shield,
  Timer,
  Wallet,
  Zap,
} from 'lucide-react';

const PRIMARY = '#00ADB5';
const GREEN = '#32d583';
const AMBER = '#f59e0b';
const DASH = '—';

// ---------------------------------------------------------------------------
// Data layer — two public endpoints, proxied to the backend via next rewrites.
// ---------------------------------------------------------------------------
type Json = Record<string, any>;

async function getJson(path: string): Promise<Json | null> {
  try {
    const res = await fetch(path, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return (await res.json()) as Json;
  } catch {
    return null;
  }
}

// Windowed executive summary via the admin proxy (adds the X-Admin-Token
// server-side) — same path the developer mission-control page uses.
async function adminProxyGet(path: string): Promise<Json | null> {
  try {
    const res = await fetch('/api/admin-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, method: 'GET' }),
    });
    const j = await res.json();
    return j?.ok && j.data ? (j.data as Json) : null;
  } catch {
    return null;
  }
}

function useEconomyData(windowQS: string) {
  const [economics, setEconomics] = useState<Json | null>(null);
  const [truth, setTruth] = useState<Json | null>(null);
  const [exec, setExec] = useState<Json | null>(null);
  const [execLoading, setExecLoading] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [e, t] = await Promise.all([
        getJson('/api/economics/summary'),
        getJson('/api/financial/truth'),
      ]);
      if (!alive) return;
      setEconomics(e);
      setTruth(t);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Windowed revenue re-fetches whenever the time filter changes.
  useEffect(() => {
    let alive = true;
    setExecLoading(true);
    (async () => {
      const res = await adminProxyGet(`/executive/summary?${windowQS}`);
      if (!alive) return;
      setExec(res);
      setExecLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [windowQS]);

  return { economics, truth, exec, execLoading, loading };
}

const usd5 = (n: unknown) =>
  typeof n === 'number' && isFinite(n) ? `$${n.toFixed(5)} USDT` : DASH;
const usd2 = (n: unknown) =>
  typeof n === 'number' && isFinite(n) ? `$${n.toFixed(2)}` : DASH;

// Honest time series: zeros for history, the real current value as the last point.
function trailingSeries(len: number, last: number, prefix = 'D') {
  return Array.from({ length: len }, (_, i) => ({
    t: `${prefix}${i + 1}`,
    v: i === len - 1 ? last : 0,
  }));
}

// ---------------------------------------------------------------------------
// Presentational helpers
// ---------------------------------------------------------------------------
function Panel({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function MiniAreaChart({
  data,
  color,
  id,
  height = 200,
}: {
  data: { t: string; v: number }[];
  color: string;
  id: string;
  height?: number;
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="t"
            tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
            interval="preserveStartEnd"
          />
          <YAxis tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} width={40} />
          <Tooltip
            contentStyle={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#${id})`} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const statusCell = (s: string) => <StatusBadge status={s} label={s} />;
const plannedCell = (s: string) =>
  s === 'ACTIVE' ? (
    <StatusBadge status="active" label="ACTIVE" />
  ) : (
    <span className="text-xs font-medium text-muted-foreground">{s}</span>
  );

// ---------------------------------------------------------------------------
// Portal
// ---------------------------------------------------------------------------
function MachinePortal() {
  const params = useSearchParams();
  const view = params.get('view') || 'mission-control';

  // Dashboard filters. Time window drives windowed revenue via /executive/summary
  // ?window=; spend threshold filters the machine-spend tables. State only.
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('24h');
  const [customFrom, setCustomFrom] = useState<string | undefined>(undefined);
  const [customTo, setCustomTo] = useState<string | undefined>(undefined);
  const [spend, setSpend] = useState<SpendThreshold>('all');
  const windowQS = useMemo(
    () => new URLSearchParams(windowParams(timeWindow, customFrom, customTo)).toString(),
    [timeWindow, customFrom, customTo],
  );
  const onTimeChange = useCallback((v: TimeWindow, from?: string, to?: string) => {
    setTimeWindow(v);
    setCustomFrom(from);
    setCustomTo(to);
  }, []);
  const spendMin = spend === 'all' ? 0 : Number(spend);

  const { economics, truth, exec, execLoading, loading } = useEconomyData(windowQS);
  const windowRevenue = exec?.revenue_window_usdt as number | undefined;
  const windowEvents = exec?.revenue_window_events as number | undefined;

  // Revenue displayed on the machine dashboard must be REAL metered revenue —
  // SUM(revenue_events_v2.amount_usdt) with test data excluded — sourced from
  // /api/financial/truth (metered_value_usdt). The epochs-table aggregate
  // (economics/summary.totalRevenueUsdt) cannot exclude test rows and overstates
  // the real figure ($0.00036 vs verified real $0.00033), so it is NOT used here.
  const metered = truth?.metered_value_usdt as number | undefined;
  const totalRevenue = metered;
  const withdrawable = truth?.withdrawable_now_usdt as number | undefined;
  const confirmedBatches = truth?.settlement?.batches_confirmed as number | undefined;
  const eventCount = truth?.pipeline?.revenue_events_v2?.count as number | undefined;
  const epochId = economics?.lastEpochId as number | undefined;
  const epochRevenue = economics?.lastEpochRevenueUsdt as number | undefined;
  const epochClosedAt = economics?.lastEpochClosedAt as string | null | undefined;

  // -------------------------------- VIEW: mission-control ------------------
  function MissionControl() {
    const row1 = [
      { label: 'Active Machines', icon: Database },
      { label: 'Active Protocols', icon: Network },
      { label: 'Active Agents', icon: Bot },
      { label: 'Active Workloads', icon: Server },
    ];
    // Revenue Generated reflects the selected time window (real metered revenue
    // in that range); falls back to lifetime metered before the window loads.
    const displayRevenue = windowRevenue ?? totalRevenue;
    const row2 = [
      { label: 'Current Spend Rate', value: DASH, icon: Gauge },
      { label: '24h Spend', value: DASH, icon: Timer },
      { label: 'Monthly Spend', value: DASH, icon: BarChart3 },
      { label: 'Revenue Generated', value: usd5(displayRevenue), icon: DollarSign },
    ];

    const workloadCols: Column<any>[] = [
      { key: 'type', header: 'Type' },
      { key: 'consumer', header: 'Consumer', muted: true },
      { key: 'revenue', header: 'Revenue', mono: true },
      { key: 'status', header: 'Status', render: (r) => plannedCell(r.status) },
    ];
    const workloadRows = loading
      ? null
      : [{ type: 'Polygon RPC', consumer: 'Network', revenue: usd5(displayRevenue), status: 'ACTIVE' }];
    // Real per-machine spend rows (none tracked yet — traffic is anonymous).
    const machineSpendRows: any[] = [];

    return (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {row1.map((k) => (
            <KPICard
              key={k.label}
              label={k.label}
              value={DASH}
              icon={k.icon}
              caption="No machines registered yet"
              loading={loading}
            />
          ))}
          {row2.map((k) => (
            <KPICard key={k.label} label={k.label} value={k.value} icon={k.icon} loading={loading} />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Panel title="Top Spending Machines" description="Highest-spend machine consumers">
            <LegacyDataTable
              columns={[
                { key: 'id', header: 'Machine ID' },
                { key: 'type', header: 'Type' },
                { key: 'wallet', header: 'Wallet', mono: true },
                { key: 'requests', header: 'Requests' },
                { key: 'spend', header: 'Spend', mono: true },
              ]}
              // Per-machine spend is not tracked yet (all traffic is anonymous),
              // so the real row set is empty. The spend-threshold filter is wired
              // over it for when this data lands — no placeholder rows.
              rows={machineSpendRows.filter((m: any) => (Number(m.spend) || 0) >= spendMin)}
              emptyLabel={spend === 'all' ? 'No machine spend yet' : `No machines above $${spend}`}
              emptyMessage="Machines appear here once they consume metered services."
            />
          </Panel>
          <Panel title="Top Protocols" description="Protocol-to-protocol consumers">
            <LegacyDataTable
              columns={[
                { key: 'protocol', header: 'Protocol' },
                { key: 'requests', header: 'Requests' },
                { key: 'revenue', header: 'Revenue', mono: true },
                { key: 'status', header: 'Status' },
              ]}
              rows={[]}
              emptyLabel="No protocol activity yet"
              emptyMessage="Protocols using the network appear here automatically."
            />
          </Panel>
          <Panel title="Top Workloads" description="Most active service types">
            <LegacyDataTable columns={workloadCols} rows={workloadRows} />
          </Panel>
        </div>
      </div>
    );
  }

  // -------------------------------- VIEW: registry -------------------------
  function Registry() {
    const kpis = [
      { label: 'Registered', icon: Database },
      { label: 'Verified', icon: CheckCircle2 },
      { label: 'Active', icon: Activity },
      { label: 'Suspended', icon: AlertTriangle },
    ];
    const types = ['Agent', 'Bot', 'Protocol', 'Automation', 'Application', 'DAO', 'Enterprise System'];
    return (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {kpis.map((k) => (
            <KPICard key={k.label} label={k.label} value={DASH} icon={k.icon} loading={loading} />
          ))}
        </div>
        <Panel title="Machine Identity Registry" description="Autonomous systems tracked by API key">
          <div className="mb-4 flex flex-wrap gap-2">
            {types.map((t) => (
              <Badge key={t} variant="secondary">{t}</Badge>
            ))}
          </div>
          <LegacyDataTable
            columns={[
              { key: 'id', header: 'Machine ID', mono: true },
              { key: 'name', header: 'Name' },
              { key: 'type', header: 'Type' },
              { key: 'wallet', header: 'Wallet', mono: true },
              { key: 'status', header: 'Status' },
              { key: 'created', header: 'Created', muted: true },
              { key: 'activity', header: 'Last Activity', muted: true },
            ]}
            rows={[]}
            emptyLabel="No machines registered"
            emptyMessage="Machines register automatically via API key usage."
          />
        </Panel>
        <Card>
          <CardContent className="py-5">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Machine identity:</span> Machines are
              identified by their API key. Any autonomous system using{' '}
              <span className="font-mono text-foreground">rpc.satelink.network</span> is
              automatically tracked as a machine consumer.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // -------------------------------- VIEW: protocols ------------------------
  function Protocols() {
    const kpis = [
      { label: 'Active Protocols', icon: Network },
      { label: 'Total Protocol Revenue', icon: DollarSign },
      { label: 'Avg Revenue Per Protocol', icon: BarChart3 },
    ];
    return (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {kpis.map((k) => (
            <KPICard key={k.label} label={k.label} value={DASH} icon={k.icon} loading={loading} />
          ))}
        </div>
        <Panel title="Protocol Registry" description="Protocol-to-protocol customers">
          <LegacyDataTable
            columns={[
              { key: 'name', header: 'Protocol Name' },
              { key: 'type', header: 'Type' },
              { key: 'requests', header: 'Requests' },
              { key: 'revenue', header: 'Revenue', mono: true },
              { key: 'credits', header: 'Credits', mono: true },
              { key: 'health', header: 'Health' },
            ]}
            rows={[]}
            emptyLabel="No protocol customers yet"
            emptyMessage="Protocols using rpc.satelink.network appear here automatically."
          />
        </Panel>
        <Card>
          <CardContent className="py-5">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Protocol customers</span> are identified
              by their API usage patterns and wallet deposits.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // -------------------------------- VIEW: consumption ----------------------
  function Consumption() {
    const kpis = [
      { label: 'RPC Calls', value: DASH, icon: Network },
      { label: 'AI Calls', value: DASH, icon: Bot },
      { label: 'Automation Jobs', value: DASH, icon: RefreshCcw },
      { label: 'Total Requests', value: eventCount != null ? eventCount.toLocaleString() : DASH, icon: BarChart3 },
    ];
    return (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {kpis.map((k) => (
            <KPICard key={k.label} label={k.label} value={k.value} icon={k.icon} loading={loading} />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Panel title="Consumption Trend" description="Metered events over the last 7 days">
            <MiniAreaChart data={trailingSeries(7, eventCount ?? 0)} color={PRIMARY} id="consTrend" height={180} />
          </Panel>
          <Panel title="Service Breakdown" description="Metered value by service over time">
            <MiniAreaChart data={trailingSeries(7, metered ?? 0)} color={AMBER} id="svcBreak" height={180} />
          </Panel>
        </div>
      </div>
    );
  }

  // -------------------------------- VIEW: wallets --------------------------
  function Wallets() {
    const kpis = [
      { label: 'Wallet Count', value: DASH, icon: Wallet, caption: undefined as string | undefined },
      {
        label: 'Deposited Balance',
        value: DASH,
        icon: DollarSign,
        caption: withdrawable != null ? `Network treasury: ${usd2(withdrawable)}` : undefined,
      },
      { label: 'Active Balance', value: DASH, icon: Activity, caption: undefined },
      { label: 'Monthly Spend', value: DASH, icon: BarChart3, caption: undefined },
    ];
    return (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {kpis.map((k) => (
            <KPICard key={k.label} label={k.label} value={k.value} icon={k.icon} caption={k.caption} loading={loading} />
          ))}
        </div>
        <Panel title="Machine Wallet Registry" description="Autonomous payment ledger">
          <LegacyDataTable
            columns={[
              { key: 'address', header: 'Wallet Address', mono: true },
              { key: 'balance', header: 'Balance', mono: true },
              { key: 'rate', header: 'Spend Rate', mono: true },
              { key: 'type', header: 'Machine Type' },
              { key: 'status', header: 'Status' },
              { key: 'activity', header: 'Last Activity', muted: true },
            ]}
            rows={[]}
            emptyLabel="No machine wallets detected"
            emptyMessage="Wallets appear when machines deposit USDT credits."
          />
        </Panel>
      </div>
    );
  }

  // -------------------------------- VIEW: agents ---------------------------
  function Agents() {
    const kpis = [
      { label: 'Active Agents', icon: Bot },
      { label: 'Agent Requests', icon: Activity },
      { label: 'Agent Revenue', icon: DollarSign },
      { label: 'Success Rate', icon: Gauge },
    ];
    const agentRows = loading
      ? null
      : [
          {
            name: 'Custom Agent',
            provider: 'Custom',
            framework: 'python-requests',
            requests: DASH,
            revenue: DASH,
            status: 'DETECTED',
          },
        ];
    return (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {kpis.map((k) => (
            <KPICard key={k.label} label={k.label} value={DASH} icon={k.icon} loading={loading} />
          ))}
        </div>
        <Panel title="Agent Registry" description="AI agents detected on the network">
          <LegacyDataTable
            columns={[
              { key: 'name', header: 'Agent Name' },
              { key: 'provider', header: 'Provider' },
              { key: 'framework', header: 'Framework', mono: true },
              { key: 'requests', header: 'Requests Today' },
              { key: 'revenue', header: 'Revenue', mono: true },
              { key: 'status', header: 'Status', render: (r) => <StatusBadge status="pending" label={r.status} /> },
            ]}
            rows={agentRows}
          />
          <p className="mt-4 text-xs text-muted-foreground">
            Agent detection is based on User-Agent classification. Agents using standard HTTP
            libraries are classified automatically.
          </p>
        </Panel>
      </div>
    );
  }

  // -------------------------------- VIEW: attribution ----------------------
  function Attribution() {
    const total = totalRevenue ?? 0;
    const pctOf = (v: number) => (total > 0 ? `${((v / total) * 100).toFixed(1)}%` : '0%');
    const kpis = [
      { label: 'RPC Revenue', value: usd5(totalRevenue), icon: Network },
      { label: 'AI Revenue', value: usd5(0), icon: Bot },
      { label: 'Automation Revenue', value: usd5(0), icon: RefreshCcw },
      { label: 'Total Machine Revenue', value: usd5(totalRevenue), icon: DollarSign },
    ];
    const breakdownRows = loading
      ? null
      : [
          { service: 'Polygon RPC', machines: DASH, requests: DASH, revenue: usd5(totalRevenue), pct: pctOf(total), status: 'ACTIVE' },
          { service: 'AI Inference', machines: DASH, requests: DASH, revenue: usd5(0), pct: '0%', status: 'PLANNED' },
          { service: 'Automation', machines: DASH, requests: DASH, revenue: usd5(0), pct: '0%', status: 'PLANNED' },
        ];
    return (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {kpis.map((k) => (
            <KPICard key={k.label} label={k.label} value={k.value} icon={k.icon} loading={loading} />
          ))}
        </div>
        <Panel title="Revenue by Service" description="RPC revenue over the last 30 days">
          <MiniAreaChart data={trailingSeries(30, total)} color={PRIMARY} id="revService" height={200} />
        </Panel>
        <Panel title="Revenue Breakdown" description="Contribution by service type">
          <LegacyDataTable
            columns={[
              { key: 'service', header: 'Service Type', render: (r) => (
                <span className="flex items-center gap-2">
                  {r.service} {plannedCell(r.status)}
                </span>
              ) },
              { key: 'machines', header: 'Machines' },
              { key: 'requests', header: 'Requests' },
              { key: 'revenue', header: 'Revenue', mono: true },
              { key: 'pct', header: '% of Total', mono: true },
            ]}
            rows={breakdownRows}
          />
        </Panel>
      </div>
    );
  }

  // -------------------------------- VIEW: settlement -----------------------
  function Settlement() {
    const kpis = [
      { label: 'Pending Settlement', value: DASH, icon: Timer },
      { label: 'Settled Revenue', value: usd5(metered), icon: CheckCircle2 },
      { label: 'Confirmed Batches', value: confirmedBatches != null ? confirmedBatches.toLocaleString() : DASH, icon: RefreshCcw },
    ];
    const settlementRows =
      loading || epochId == null
        ? loading
          ? null
          : []
        : [
            {
              epoch: `#${epochId}`,
              machine: 'Network',
              amount: usd5(epochRevenue),
              status: epochClosedAt ? 'confirmed' : 'pending',
              statusLabel: epochClosedAt ? 'Closed' : 'Open',
              settled: epochClosedAt ?? DASH,
            },
          ];
    return (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {kpis.map((k) => (
            <KPICard key={k.label} label={k.label} value={k.value} icon={k.icon} loading={loading} />
          ))}
        </div>
        <Panel title="Settlement History" description="Financial lifecycle for autonomous payments">
          <LegacyDataTable
            columns={[
              { key: 'epoch', header: 'Epoch', mono: true },
              { key: 'machine', header: 'Machine', muted: true },
              { key: 'amount', header: 'Amount USDT', mono: true },
              { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} label={r.statusLabel} /> },
              { key: 'settled', header: 'Settled At', muted: true },
            ]}
            rows={settlementRows}
            emptyLabel="No settlements yet"
            emptyMessage="Settlement rows populate from the epoch ledger."
          />
        </Panel>
      </div>
    );
  }

  // -------------------------------- VIEW: autonomous -----------------------
  function Autonomous() {
    const total = totalRevenue ?? 0;
    const txns = eventCount ?? 0;
    const kpis = [
      { label: 'Machine Revenue %', value: DASH, icon: Bot },
      { label: 'Human Revenue %', value: DASH, icon: Shield },
      { label: 'Protocol Revenue %', value: DASH, icon: Network },
      { label: 'Autonomous Transactions', value: txns.toLocaleString(), icon: Zap },
    ];
    const charts = [
      { title: 'M2M Revenue Growth', color: PRIMARY, id: 'm2m', last: total },
      { title: 'Protocol Revenue Growth', color: GREEN, id: 'proto', last: 0 },
      { title: 'Agent Revenue Growth', color: AMBER, id: 'agent', last: 0 },
    ];
    return (
      <div className="flex flex-col gap-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-8">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Total Autonomous Transactions
            </span>
            <span className="font-mono text-5xl font-bold text-foreground">
              {txns.toLocaleString()}
            </span>
            <span className="text-xs text-muted-foreground">Recorded across the network</span>
          </CardContent>
        </Card>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {kpis.map((k) => (
            <KPICard key={k.label} label={k.label} value={k.value} icon={k.icon} loading={loading} />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {charts.map((c) => (
            <Panel key={c.id} title={c.title} description="Last 30 days">
              <MiniAreaChart data={trailingSeries(30, c.last)} color={c.color} id={c.id} height={140} />
            </Panel>
          ))}
        </div>
        <Card>
          <CardHeader>
            <CardTitle>The Machine Economy Vision</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Satelink is building the first autonomous infrastructure network where machines
              discover, pay for, and consume compute resources without human intervention. Every API
              call is a machine transaction. Every settlement is an autonomous payment. The network
              grows as more autonomous systems find and pay for Satelink services.
            </p>
            <div className="rounded-md border border-primary/30 bg-primary/5 px-4 py-3">
              <span className="text-sm font-medium text-foreground">
                Current: {txns.toLocaleString()} autonomous transactions recorded
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const views: Record<string, () => React.ReactElement> = useMemo(
    () => ({
      'mission-control': MissionControl,
      registry: Registry,
      protocols: Protocols,
      consumption: Consumption,
      wallets: Wallets,
      agents: Agents,
      attribution: Attribution,
      settlement: Settlement,
      autonomous: Autonomous,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loading, economics, truth, exec, spend, windowQS]
  );

  const Active = views[view] ?? MissionControl;
  return (
    <div className="flex flex-col gap-4">
      {/* FILTER BAR — time window + spend threshold, shown on every machine view. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <TimeRangeFilter value={timeWindow} onChange={onTimeChange} customFrom={customFrom} customTo={customTo} />
          <SpendThresholdFilter value={spend} onChange={setSpend} />
        </div>
        <span className="text-xs font-mono text-muted-foreground tabular-nums">
          {execLoading
            ? 'Loading window…'
            : exec
              ? `Window ${exec.window ?? timeWindow}: ${usd5(windowRevenue ?? 0)} · ${windowEvents ?? 0} events`
              : 'No data for this period'}
        </span>
      </div>
      <Active />
    </div>
  );
}

export default function MachinePage() {
  return (
    <Suspense fallback={null}>
      <MachinePortal />
    </Suspense>
  );
}
