"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  KPICard,
  EmptyState,
  StatusBadge,
  Button,
  Input,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@satelink/ui";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  DollarSign,
  Gauge,
  HardDrive,
  Heart,
  Inbox,
  Layers,
  Power,
  Server,
  Shield,
  Timer,
  Wallet,
  Zap,
} from "lucide-react";

const PRIMARY = "#00ADB5";
const AMBER = "#f59e0b";
const DASH = "—";

// ---------------------------------------------------------------------------
// Data layer — three public endpoints, proxied to the backend via next rewrites.
// ---------------------------------------------------------------------------
type Json = Record<string, any>;

async function getJson(path: string): Promise<Json | null> {
  try {
    const res = await fetch(path, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as Json;
  } catch {
    return null;
  }
}

function useNetworkData() {
  const [status, setStatus] = useState<Json | null>(null);
  const [economics, setEconomics] = useState<Json | null>(null);
  const [truth, setTruth] = useState<Json | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [s, e, t] = await Promise.all([
        getJson("/api/status"),
        getJson("/api/economics/summary"),
        getJson("/api/financial/truth"),
      ]);
      if (!alive) return;
      setStatus(s);
      setEconomics(e);
      setTruth(t);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  return { status, economics, truth, loading };
}

const usd = (n: unknown) =>
  typeof n === "number" && isFinite(n) ? `$${n.toFixed(2)}` : DASH;

// Flat zero-series placeholders — replaced by live per-node series after a node
// registers and begins reporting telemetry.
const ZERO_30 = Array.from({ length: 30 }, (_, i) => ({ t: `D${i + 1}`, v: 0 }));
const ZERO_24 = Array.from({ length: 24 }, (_, i) => ({
  t: `${String(i).padStart(2, "0")}:00`,
  v: 0,
}));

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------
function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
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
            tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
            interval="preserveStartEnd"
          />
          <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} width={40} />
          <Tooltip
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${id})`}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function ProgressRow({ label, value }: { label: string; value: number | null }) {
  const pct = value ?? 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-40 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-10 shrink-0 text-right font-mono text-xs text-foreground">
        {value == null ? DASH : value}
      </span>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const selectCls =
  "h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40";

// ---------------------------------------------------------------------------
// Portal
// ---------------------------------------------------------------------------
function NodePortal() {
  const params = useSearchParams();
  const view = params.get("view") || "overview";
  const { status, economics, truth, loading } = useNetworkData();

  // Local-only form state for capacity / config (no API writes yet).
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const flashSaved = () => {
    setSavedFlash("Saved locally");
    setTimeout(() => setSavedFlash(null), 2000);
  };

  const withdrawable = truth?.withdrawable_now_usdt as number | undefined;
  const canWithdraw = typeof withdrawable === "number" && withdrawable >= 1;

  const registerCta = (
    <Button asChild variant="outline">
      <Link href="/node/setup">Register your node</Link>
    </Button>
  );

  const emptyTable = (title: string, description: string) => (
    <EmptyState icon={Inbox} title={title} description={description} />
  );

  // ------------------------------- VIEW 1 ----------------------------------
  function Overview() {
    const kpis: { label: string; value: React.ReactNode; icon: any; caption?: string }[] = [
      { label: "Node Status", value: DASH, icon: Power, caption: "Register your node to see live data" },
      { label: "Reputation Score", value: DASH, icon: Shield, caption: "Tracked after first heartbeat" },
      { label: "Earnings (24h)", value: DASH, icon: DollarSign, caption: "Per-node earnings" },
      { label: "Lifetime Earnings", value: DASH, icon: Wallet, caption: "Per-node earnings" },
      { label: "Capacity Used", value: DASH, icon: Server, caption: "Advertised vs allocated" },
      { label: "Active Workloads", value: DASH, icon: Cpu, caption: "Jobs currently served" },
      { label: "Last Heartbeat", value: DASH, icon: Heart, caption: "Awaiting first ping" },
      { label: "Current Tier", value: DASH, icon: Layers, caption: "Standard / Premium / Enterprise" },
    ];
    return (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map((k) => (
            <KPICard
              key={k.label}
              label={k.label}
              value={k.value}
              icon={k.icon}
              caption={k.caption}
              loading={loading}
            />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Panel title="Recent Earnings" description="Latest epoch settlements for this node">
            {emptyTable(
              "No earnings yet",
              "Register and run your node to start accruing epoch rewards."
            )}
          </Panel>
          <Panel title="Recent Workloads" description="Requests served across supported services">
            {emptyTable(
              "No workloads yet",
              "Workload activity appears once your node begins serving traffic."
            )}
          </Panel>
        </div>
        <EmptyState
          icon={Server}
          title="No node registered yet"
          description="Connect a node to unlock live status, earnings and performance telemetry."
          action={registerCta}
        />
      </div>
    );
  }

  // ------------------------------- VIEW 2 ----------------------------------
  function Earnings() {
    const epochId = economics?.lastEpochId;
    const epochRevenue = economics?.lastEpochRevenueUsdt as number | undefined;
    const sharePct = economics?.splitRatio?.nodeOperators as number | undefined;
    const closedAt = economics?.lastEpochClosedAt as string | null | undefined;
    const confirmedBatches = truth?.settlement?.batches_confirmed as number | undefined;

    const kpis = [
      { label: "Today", value: DASH, icon: DollarSign },
      { label: "Epoch", value: epochId != null ? `#${epochId}` : DASH, icon: Layers },
      { label: "Pending", value: DASH, icon: Timer },
      { label: "Settled", value: DASH, icon: CheckCircle2 },
      { label: "Withdrawable", value: usd(withdrawable), icon: Wallet },
    ];
    return (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {kpis.map((k) => (
            <KPICard key={k.label} label={k.label} value={k.value} icon={k.icon} loading={loading} />
          ))}
        </div>
        <Panel title="Earnings Trend" description="USDT earned per day (last 30 days)">
          <MiniAreaChart data={ZERO_30} color={PRIMARY} id="earnTrend" height={200} />
        </Panel>
        <Panel title="Epoch History" description="Revenue and your share per closed epoch">
          {epochId == null ? (
            emptyTable("No epoch data", "Epoch history will populate from the settlement ledger.")
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Epoch</TableHead>
                  <TableHead>Revenue (USDT)</TableHead>
                  <TableHead>Your Share</TableHead>
                  <TableHead>Your Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Closed At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-mono">#{epochId}</TableCell>
                  <TableCell>{usd(epochRevenue)}</TableCell>
                  <TableCell>{sharePct != null ? `${sharePct}%` : DASH}</TableCell>
                  <TableCell>{DASH}</TableCell>
                  <TableCell>
                    <StatusBadge status={closedAt ? "confirmed" : "pending"} label={closedAt ? "Closed" : "Open"} />
                  </TableCell>
                  <TableCell>{closedAt ?? DASH}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </Panel>
        <Panel title="Settlement History" description="On-chain settlement batches">
          {emptyTable(
            "No per-node settlements yet",
            `${confirmedBatches ?? 0} batches confirmed network-wide. Your settlement rows appear after registration.`
          )}
        </Panel>
      </div>
    );
  }

  // ------------------------------- VIEW 3 ----------------------------------
  function Workloads() {
    const rows = [
      { type: "Polygon RPC", status: "ACTIVE", description: "EVM JSON-RPC relay" },
      { type: "AI Inference", status: "PLANNED", description: "Coming in Phase 2" },
      { type: "Automation Jobs", status: "PLANNED", description: "Coming in Phase 2" },
      { type: "Webhook Processing", status: "PLANNED", description: "Coming in Phase 2" },
    ];
    const kpis = [
      { label: "Active Jobs", value: DASH, icon: Zap },
      { label: "Completed", value: DASH, icon: CheckCircle2 },
      { label: "Success Rate", value: DASH, icon: Gauge },
      { label: "Avg Latency", value: DASH, icon: Timer },
    ];
    return (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {kpis.map((k) => (
            <KPICard key={k.label} label={k.label} value={k.value} icon={k.icon} loading={loading} />
          ))}
        </div>
        <Panel title="Workload Registry" description="Supported service types and their availability">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Requests Served</TableHead>
                <TableHead>Revenue Generated</TableHead>
                <TableHead>Success Rate</TableHead>
                <TableHead>Avg Latency</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const active = r.status === "ACTIVE";
                return (
                  <TableRow key={r.type}>
                    <TableCell>
                      <div className="font-medium text-foreground">{r.type}</div>
                      <div className="text-xs text-muted-foreground">{r.description}</div>
                    </TableCell>
                    <TableCell>{DASH}</TableCell>
                    <TableCell>{DASH}</TableCell>
                    <TableCell>{DASH}</TableCell>
                    <TableCell>{DASH}</TableCell>
                    <TableCell>
                      {active ? (
                        <StatusBadge status="active" label="ACTIVE" />
                      ) : (
                        <span className="text-xs font-medium text-muted-foreground">PLANNED</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Panel>
      </div>
    );
  }

  // ------------------------------- VIEW 4 ----------------------------------
  function Performance() {
    const netUptime = status?.uptime_pct as number | undefined;
    const netLatency = status?.avg_latency_ms as number | undefined;
    const kpis = [
      { label: "Uptime", value: DASH, icon: Power, caption: netUptime != null ? `Network: ${netUptime}%` : undefined },
      { label: "Avg Latency", value: DASH, icon: Timer, caption: netLatency != null ? `Network: ${netLatency}ms` : undefined },
      { label: "Success Rate", value: DASH, icon: Gauge },
      { label: "Throughput", value: DASH, icon: Activity },
    ];
    return (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {kpis.map((k) => (
            <KPICard key={k.label} label={k.label} value={k.value} icon={k.icon} caption={k.caption} loading={loading} />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Panel title="Response Time" description="Average latency over the last 24 hours">
            <MiniAreaChart data={ZERO_24} color={AMBER} id="respTime" height={200} />
          </Panel>
          <Panel title="Request Volume" description="Requests served over the last 24 hours">
            <MiniAreaChart data={ZERO_24} color={PRIMARY} id="reqVol" height={200} />
          </Panel>
        </div>
        <Panel title="SLA History" description="Per-period availability and incidents">
          {emptyTable(
            "Performance data tracked after node registration",
            "SLA windows, latency and incident counts appear once your node reports telemetry."
          )}
        </Panel>
      </div>
    );
  }

  // ------------------------------- VIEW 5 ----------------------------------
  function Reputation() {
    const kpis = [
      { label: "Score", value: DASH, icon: Shield },
      { label: "Tier", value: DASH, icon: Layers },
      { label: "Penalties", value: DASH, icon: AlertTriangle },
      { label: "Bonuses", value: DASH, icon: Zap },
    ];
    const breakdown = [
      "Availability",
      "Performance",
      "Accuracy",
      "Consistency",
      "Settlement History",
    ];
    return (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardContent className="flex flex-col items-center justify-center gap-3 py-10">
              <div className="flex size-32 items-center justify-center rounded-full border-4 border-primary/30">
                <span className="font-mono text-4xl font-bold text-foreground">{DASH}</span>
              </div>
              <span className="text-xs text-muted-foreground">Reputation score (0–100)</span>
            </CardContent>
          </Card>
          <div className="grid grid-cols-2 gap-4 lg:col-span-2">
            {kpis.map((k) => (
              <KPICard key={k.label} label={k.label} value={k.value} icon={k.icon} loading={loading} />
            ))}
          </div>
        </div>
        <Panel title="Score Breakdown" description="Component scores that make up your reputation">
          <div className="flex flex-col gap-4">
            {breakdown.map((b) => (
              <ProgressRow key={b} label={b} value={null} />
            ))}
          </div>
          <div className="mt-6">
            <EmptyState
              icon={Heart}
              title="Reputation tracked after first heartbeat"
              description="Component scores populate once your node reports availability and performance."
            />
          </div>
        </Panel>
      </div>
    );
  }

  // ------------------------------- VIEW 6 ----------------------------------
  function Withdrawals() {
    const lifetime = truth?.claimed_total_usdt as number | undefined;
    const kpis = [
      { label: "Available", value: usd(withdrawable), icon: Wallet },
      { label: "Pending", value: DASH, icon: Timer },
      { label: "Lifetime Withdrawn", value: usd(lifetime), icon: CheckCircle2 },
    ];
    return (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {kpis.map((k) => (
            <KPICard key={k.label} label={k.label} value={k.value} icon={k.icon} loading={loading} />
          ))}
        </div>
        <Panel title="Withdraw Funds" description="Move settled USDT to your wallet">
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={!canWithdraw} title={!canWithdraw ? "Minimum $1.00 USDT required" : undefined}>
              Initiate Withdrawal
            </Button>
            {!canWithdraw ? (
              <span className="text-xs text-muted-foreground">Minimum $1.00 USDT required</span>
            ) : null}
          </div>
        </Panel>
        <Panel title="Withdrawal History" description="Past withdrawals and their on-chain status">
          {emptyTable("No withdrawals yet", "Completed and pending withdrawals will be listed here.")}
        </Panel>
      </div>
    );
  }

  // ------------------------------- VIEW 7 ----------------------------------
  function Capacity() {
    const kpis = [
      { label: "Advertised", value: DASH, icon: Server },
      { label: "Allocated", value: DASH, icon: HardDrive },
      { label: "Available", value: DASH, icon: Gauge },
    ];
    return (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {kpis.map((k) => (
            <KPICard key={k.label} label={k.label} value={k.value} icon={k.icon} loading={loading} />
          ))}
        </div>
        <Panel title="Capacity Settings" description="Advertise how much your node can serve (saved locally for now)">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="Max RPS">
              <Input placeholder="1000" inputMode="numeric" />
            </Field>
            <Field label="Region">
              <select className={selectCls} defaultValue="Asia-Pacific">
                <option>Asia-Pacific</option>
                <option>North America</option>
                <option>Europe</option>
                <option>Global</option>
              </select>
            </Field>
            <Field label="Services">
              <div className="flex flex-col gap-2 pt-1">
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input type="checkbox" defaultChecked className="accent-primary" /> Polygon RPC
                </label>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input type="checkbox" className="accent-primary" /> AI Inference
                </label>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input type="checkbox" className="accent-primary" /> Webhooks
                </label>
              </div>
            </Field>
            <Field label="Pricing Tier">
              <div className="flex flex-col gap-2 pt-1">
                {["Standard", "Premium", "Enterprise"].map((tier, i) => (
                  <label key={tier} className="flex items-center gap-2 text-sm text-foreground">
                    <input type="radio" name="pricingTier" defaultChecked={i === 0} className="accent-primary" />
                    {tier}
                  </label>
                ))}
              </div>
            </Field>
          </div>
          <div className="mt-6 flex items-center gap-3">
            <Button onClick={flashSaved} variant="outline">Save Capacity</Button>
            {savedFlash ? <span className="text-xs text-success">{savedFlash}</span> : (
              <span className="text-xs text-muted-foreground">Register node first to publish capacity</span>
            )}
          </div>
        </Panel>
      </div>
    );
  }

  // ------------------------------- VIEW 8 ----------------------------------
  function Config() {
    return (
      <div className="flex flex-col gap-6">
        <Panel title="Node Configuration" description="Operator identity and alerting (saved locally for now)">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="Wallet Address">
              <Input placeholder="0x..." />
            </Field>
            <Field label="Node Hostname">
              <Input placeholder="node-1.yourdomain.com" />
            </Field>
            <Field label="Region">
              <select className={selectCls} defaultValue="Asia-Pacific">
                <option>Asia-Pacific</option>
                <option>North America</option>
                <option>Europe</option>
                <option>Global</option>
              </select>
            </Field>
            <Field label="Contact Email">
              <Input placeholder="you@example.com" type="email" />
            </Field>
            <Field label="Alert Notifications">
              <label className="flex items-center gap-2 pt-1 text-sm text-foreground">
                <input type="checkbox" defaultChecked className="accent-primary" /> Enabled
              </label>
            </Field>
            <Field label="Heartbeat Interval">
              <select className={selectCls} defaultValue="60s">
                <option>30s</option>
                <option>60s</option>
                <option>5min</option>
              </select>
            </Field>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button onClick={flashSaved} variant="outline">Save Configuration</Button>
            {savedFlash ? <span className="text-xs text-success">{savedFlash}</span> : (
              <span className="text-xs text-muted-foreground">Register node first to apply settings</span>
            )}
            <Button asChild variant="ghost">
              <Link href="/node/setup">Full registration flow →</Link>
            </Button>
          </div>
        </Panel>
      </div>
    );
  }

  // ------------------------------- VIEW 9 ----------------------------------
  function Alerts() {
    const rows = [
      { id: "ALT-001", severity: "info", message: "Node not yet registered", triggered_at: DASH, resolved_at: DASH, status: "open" },
      { id: "ALT-002", severity: "warn", message: "No heartbeat received", triggered_at: DASH, resolved_at: DASH, status: "open" },
    ];
    const sevTone = (s: string) =>
      s === "critical" ? "destructive" : s === "warn" ? "warning" : "default";
    const kpis = [
      { label: "Open", value: 2, icon: AlertTriangle },
      { label: "Critical", value: 0, icon: AlertTriangle },
      { label: "Resolved", value: 0, icon: CheckCircle2 },
    ];
    return (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {kpis.map((k) => (
            <KPICard key={k.label} label={k.label} value={k.value} icon={k.icon} />
          ))}
        </div>
        <Panel title="Alert Log" description="Operational alerts for this node">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Triggered</TableHead>
                <TableHead>Resolved</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono">{r.id}</TableCell>
                  <TableCell>
                    <StatusBadge status={r.severity} variant={sevTone(r.severity) as any} label={r.severity.toUpperCase()} />
                  </TableCell>
                  <TableCell>{r.message}</TableCell>
                  <TableCell>{r.triggered_at}</TableCell>
                  <TableCell>{r.resolved_at}</TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} label={r.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      </div>
    );
  }

  const views: Record<string, () => React.ReactElement> = useMemo(
    () => ({
      overview: Overview,
      earnings: Earnings,
      workloads: Workloads,
      performance: Performance,
      reputation: Reputation,
      withdrawals: Withdrawals,
      capacity: Capacity,
      config: Config,
      alerts: Alerts,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loading, status, economics, truth, savedFlash]
  );

  const Active = views[view] ?? Overview;
  return <Active />;
}

export default function NodePage() {
  return (
    <Suspense fallback={null}>
      <NodePortal />
    </Suspense>
  );
}
