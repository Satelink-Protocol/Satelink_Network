"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, GripVertical, Maximize2, Minimize2 } from "lucide-react";
import type { AccountPlan, RequestLog, Spend, UsageSeries } from "@/lib/v2-shared";
import { BarList, Heatmap, LineChart, Meter, Stat } from "./charts";
import { MarketPanel } from "./MarketPanel";
import { LogsPanel } from "./LogsPanel";

export type DashData = {
  range: string;
  keys: { id: number; label: string; hint: string; balanceUsdt: number; scopes: string[] | null }[] | null;
  usage: UsageSeries | null;
  spend: Spend | null;
  plan: AccountPlan | null;
  requests: RequestLog | null;
  layout: { id: string; w: number }[] | null;
  layoutId: number | null;
};

const DEFAULT: { id: string; w: number }[] = [
  { id: "stat-credits", w: 3 }, { id: "stat-spend", w: 3 }, { id: "stat-requests", w: 3 }, { id: "stat-errors", w: 3 },
  { id: "uu", w: 6 }, { id: "bar-agents", w: 6 },
  { id: "ts-requests", w: 6 }, { id: "ts-spend", w: 6 },
  { id: "heat-hours", w: 6 }, { id: "bar-errors", w: 6 },
  { id: "mkt-funding", w: 12 }, { id: "mkt-oi", w: 6 }, { id: "mkt-micro", w: 6 }, { id: "mkt-liq", w: 12 },
  { id: "logs", w: 12 },
];
const TITLES: Record<string, string> = {
  "stat-credits": "Balance", "stat-spend": "Spend", "stat-requests": "Requests", "stat-errors": "Error rate",
  uu: "Plan usage", "bar-agents": "Top agents", "ts-requests": "Requests by agent", "ts-spend": "Spend by agent",
  "heat-hours": "Requests by hour", "bar-errors": "Errors by status", "mkt-funding": "Funding heatmap",
  "mkt-oi": "Open-interest change", "mkt-micro": "Spread", "mkt-liq": "Liquidation pressure (model)", logs: "Request log",
};
const SIZES = [3, 4, 6, 12];
const RANGES = ["1h", "24h", "7d", "30d", "90d"];
const REFRESH = [0, 30, 60, 300];
const colSpan: Record<number, string> = { 3: "xl:col-span-3", 4: "xl:col-span-4", 6: "xl:col-span-6", 12: "xl:col-span-12" };
const mdSpan: Record<number, string> = { 3: "md:col-span-6", 4: "md:col-span-6", 6: "md:col-span-12", 12: "md:col-span-12" };

export function DashboardGrid({ data }: { data: DashData }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [layout, setLayout] = useState(() => {
    const saved = data.layout?.filter((p) => TITLES[p.id]) ?? [];
    return saved.length ? [...saved, ...DEFAULT.filter((d) => !saved.some((s) => s.id === d.id))] : DEFAULT;
  });
  const [dirty, setDirty] = useState(false);
  const [keyVar, setKeyVar] = useState<string>("all");
  const [productVar, setProductVar] = useState<string>("all");
  const [refresh, setRefresh] = useState(0);
  const dragId = useRef<string | null>(null);

  useEffect(() => {
    if (!refresh) return;
    const t = setInterval(() => router.refresh(), refresh * 1000); // free reads only; market panels never auto-run
    return () => clearInterval(t);
  }, [refresh, router]);

  const setRange = (r: string) => { const q = new URLSearchParams(params.toString()); q.set("range", r); router.push(`${pathname}?${q}`); };
  const move = (id: string, dir: -1 | 1) => { setLayout((l) => { const i = l.findIndex((p) => p.id === id); const j = i + dir; if (j < 0 || j >= l.length) return l; const n = [...l]; [n[i], n[j]] = [n[j], n[i]]; return n; }); setDirty(true); };
  const resize = (id: string, grow: boolean) => { setLayout((l) => l.map((p) => (p.id !== id ? p : { ...p, w: SIZES[Math.max(0, Math.min(SIZES.length - 1, SIZES.indexOf(p.w) + (grow ? 1 : -1)))] }))); setDirty(true); };
  const drop = (target: string) => { const src = dragId.current; if (!src || src === target) return; setLayout((l) => { const n = l.filter((p) => p.id !== src); const i = n.findIndex((p) => p.id === target); n.splice(i, 0, l.find((p) => p.id === src)!); return n; }); setDirty(true); };
  async function saveLayout() {
    if (data.layoutId) await fetch(`/api/console/me/saved-queries/${data.layoutId}`, { method: "DELETE" });
    await fetch("/api/console/me/saved-queries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "__layout:advanced", query: { kind: "layout", panels: layout } }) });
    setDirty(false);
    router.refresh();
  }

  const keyIds = useMemo(() => (keyVar === "all" ? null : new Set([Number(keyVar)])), [keyVar]);
  const series = (data.usage?.keys ?? []).filter((k) => !keyIds || keyIds.has(k.id));
  const x = series[0]?.points.map((p) => p.date.slice(5)) ?? [];
  const reqs = (data.requests?.items ?? []).filter((r) => (!keyIds || keyIds.has(r.key.id)) && (productVar === "all" || r.product === productVar));
  const errors = reqs.filter((r) => r.status !== "completed");
  const byStatus = Object.entries(reqs.reduce<Record<string, number>>((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {})).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const hours = ["00", "03", "06", "09", "12", "15", "18", "21"];
  const heat = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of reqs) { const d = new Date(r.at); const k = `${days[(d.getDay() + 6) % 7]}|${hours[Math.floor(d.getHours() / 3)]}`; m.set(k, (m.get(k) || 0) + 1); }
    return m;
  }, [reqs]); // eslint-disable-line react-hooks/exhaustive-deps
  const keysShown = (data.keys ?? []).filter((k) => !keyIds || keyIds.has(k.id));
  const credits = keysShown.reduce((a, k) => a + k.balanceUsdt, 0);
  const label = (id: number) => data.keys?.find((k) => k.id === id)?.label ?? `Key ${id}`;
  const weekElapsed = data.plan ? Math.max(0.05, 1 - (new Date(data.plan.windows.weekly.resetsAt).getTime() - Date.now()) / (7 * 864e5)) : 1;
  const projected = data.plan ? Math.round(data.plan.windows.weekly.usedUu / weekElapsed) : 0;

  function panel(id: string) {
    switch (id) {
      case "stat-credits": return <Stat label="Crypto credits" value={data.keys ? `$${credits.toFixed(4)}` : null} hint={data.plan ? `Pack ${data.plan.packBalanceUu.toLocaleString()} UU · plan ${Math.max(0, data.plan.windows.weekly.capUu - data.plan.windows.weekly.usedUu).toLocaleString()} UU left this week` : undefined} />;
      case "stat-spend": return <Stat label="Spend this month (credits)" value={data.spend ? `$${(keyIds ? data.spend.perKey.filter((k) => keyIds.has(k.id)).reduce((a, k) => a + k.monthUsdt, 0) : data.spend.monthSpentUsdt).toFixed(4)}` : null} spark={series.length ? series[0].points.map((p, i) => series.reduce((a, s) => a + (s.points[i]?.spentUsdt ?? 0), 0)) : undefined} />;
      case "stat-requests": return <Stat label={`Requests (${data.range === "1h" || data.range === "24h" ? "today" : data.range})`} value={series.length ? series.reduce((a, k) => a + k.points.slice(-(data.range === "7d" ? 7 : data.range === "90d" ? 90 : data.range === "30d" ? 30 : 1)).reduce((b, p) => b + p.requests, 0), 0).toLocaleString() : null} hint="Daily totals (UTC), same source as the charts" spark={series.length ? series[0].points.map((p, i) => series.reduce((a, s) => a + (s.points[i]?.requests ?? 0), 0)) : undefined} />;
      case "stat-errors": return <Stat label="Error rate" value={reqs.length ? `${((errors.length / reqs.length) * 100).toFixed(1)}%` : null} hint={reqs.length ? `${errors.length} of ${reqs.length} not completed` : "No requests in range"} />;
      case "uu": return data.plan ? (
        <div className="space-y-3">
          <Meter label="Session" used={data.plan.windows.session.usedUu} cap={data.plan.windows.session.capUu} />
          <Meter label="Week" used={data.plan.windows.weekly.usedUu} cap={data.plan.windows.weekly.capUu} hint={`Projection at this week's pace: ~${projected.toLocaleString()} UU by reset (${Math.round((projected / Math.max(1, data.plan.windows.weekly.capUu)) * 100)}% of allowance). Linear estimate, not a forecast model.`} />
        </div>
      ) : <p className="text-sl-text-muted">Plan usage unavailable.</p>;
      case "bar-agents": return data.spend && data.spend.perKey.length ? <BarList title="Spend this month by agent" items={data.spend.perKey.filter((k) => !keyIds || keyIds.has(k.id)).map((k) => ({ label: label(k.id), value: k.monthUsdt })).sort((a, b) => b.value - a.value).slice(0, 8)} fmt={(v) => `$${v.toFixed(4)}`} /> : <p className="text-sl-text-muted">No agent spending yet.</p>;
      case "ts-requests": return series.length ? <LineChart title="Requests per day" x={x} series={series.slice(0, 4).map((s) => ({ label: s.label, values: s.points.map((p) => p.requests) }))} fmt={(v) => v.toFixed(0)} caption={series.length > 4 ? "Top 4 agents shown; pick one with the Key variable." : undefined} /> : <p className="text-sl-text-muted">No usage yet.</p>;
      case "ts-spend": return series.length ? <LineChart title="Spend per day (credits)" x={x} area series={series.slice(0, 4).map((s) => ({ label: s.label, values: s.points.map((p) => p.spentUsdt) }))} fmt={(v) => `$${v.toFixed(4)}`} /> : <p className="text-sl-text-muted">No spending yet.</p>;
      case "heat-hours": return reqs.length ? <Heatmap title="Requests by weekday × hour (local time)" rows={days} cols={hours} value={(r, c) => heat.get(`${r}|${c}`) ?? 0} fmt={(v) => v.toFixed(0)} caption={`From the latest ${reqs.length} requests in range.`} /> : <p className="text-sl-text-muted">No requests in this range.</p>;
      case "bar-errors": return byStatus.length ? <BarList title="Requests by status" items={byStatus} fmt={(v) => v.toFixed(0)} color="var(--chart-3)" /> : <p className="text-sl-text-muted">No requests in this range.</p>;
      case "mkt-funding": return <MarketPanel metric="funding-rate-heatmap" keys={data.keys ?? []} keyVar={keyVar} />;
      case "mkt-oi": return <MarketPanel metric="open-interest-shifts" keys={data.keys ?? []} keyVar={keyVar} />;
      case "mkt-micro": return <MarketPanel metric="market-microstructure" keys={data.keys ?? []} keyVar={keyVar} />;
      case "mkt-liq": return <MarketPanel metric="liquidation-clusters" keys={data.keys ?? []} keyVar={keyVar} />;
      case "logs": return <LogsPanel initial={data.requests} keys={data.keys ?? []} keyVar={keyVar} productVar={productVar} range={data.range} />;
      default: return null;
    }
  }

  const sel = "h-8 rounded-[var(--sl-radius-sm)] border border-sl-border bg-sl-surface px-2 text-[12px] text-sl-text";
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2" role="toolbar" aria-label="Dashboard controls">
        <h1 className="mr-auto text-lg font-semibold text-sl-text">Dashboard</h1>
        <div role="radiogroup" aria-label="Time range" className="flex rounded-[var(--sl-radius-sm)] border border-sl-border p-0.5">
          {RANGES.map((r) => <button key={r} role="radio" aria-checked={data.range === r} onClick={() => setRange(r)} className={`rounded-[4px] px-2 py-0.5 text-[12px] ${data.range === r ? "bg-sl-surface-hover text-sl-text" : "text-sl-text-muted"}`}>{r}</button>)}
        </div>
        <label className="flex items-center gap-1 text-[12px] text-sl-text-muted">Key
          <select className={sel} value={keyVar} onChange={(e) => setKeyVar(e.target.value)}><option value="all">All</option>{(data.keys ?? []).map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select>
        </label>
        <label className="flex items-center gap-1 text-[12px] text-sl-text-muted">Product
          <select className={sel} value={productVar} onChange={(e) => setProductVar(e.target.value)}><option value="all">All</option><option value="rpc">RPC</option><option value="intelligence">Market data</option></select>
        </label>
        <label className="flex items-center gap-1 text-[12px] text-sl-text-muted">Refresh
          <select className={sel} value={refresh} onChange={(e) => setRefresh(Number(e.target.value))}>{REFRESH.map((s) => <option key={s} value={s}>{s ? `${s < 60 ? s + "s" : s / 60 + "m"}` : "Off"}</option>)}</select>
        </label>
        {dirty && <button onClick={saveLayout} className="h-8 rounded-[var(--sl-radius-sm)] bg-sl-accent px-3 text-[12px] font-medium text-sl-accent-ink">Save layout</button>}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
        {layout.map((p) => (
          <section key={p.id} aria-label={TITLES[p.id]} className={`min-w-0 rounded-[var(--sl-radius)] border border-sl-border bg-sl-surface ${mdSpan[p.w]} ${colSpan[p.w]}`}
            onDragOver={(e) => e.preventDefault()} onDrop={() => drop(p.id)}>
            <header className="flex items-center gap-1 border-b border-sl-border px-2 py-1.5">
              <span draggable onDragStart={() => (dragId.current = p.id)} className="cursor-grab text-sl-text-subtle" aria-hidden><GripVertical className="size-3.5" /></span>
              <h2 className="mr-auto truncate text-[12px] font-medium text-sl-text-muted">{TITLES[p.id]}</h2>
              <button aria-label={`Move ${TITLES[p.id]} earlier`} onClick={() => move(p.id, -1)} className="p-0.5 text-sl-text-subtle hover:text-sl-text"><ArrowLeft className="size-3.5" /></button>
              <button aria-label={`Move ${TITLES[p.id]} later`} onClick={() => move(p.id, 1)} className="p-0.5 text-sl-text-subtle hover:text-sl-text"><ArrowRight className="size-3.5" /></button>
              <button aria-label={`Make ${TITLES[p.id]} smaller`} onClick={() => resize(p.id, false)} className="p-0.5 text-sl-text-subtle hover:text-sl-text"><Minimize2 className="size-3.5" /></button>
              <button aria-label={`Make ${TITLES[p.id]} larger`} onClick={() => resize(p.id, true)} className="p-0.5 text-sl-text-subtle hover:text-sl-text"><Maximize2 className="size-3.5" /></button>
            </header>
            <div className="p-3">{panel(p.id)}</div>
          </section>
        ))}
      </div>
    </div>
  );
}
