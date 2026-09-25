"use client";
// Simple-mode task flow: "Get market data". Steps: what → which market →
// price & run → result. The result is a chart, a table and ONE factual line —
// never a recommendation. The key never reaches the browser: the run goes
// /api/console/me/intelligence/:metric → API resolves the account's key.
import { useMemo, useState } from "react";
import Link from "next/link";
import { Copy, Download, Save } from "lucide-react";
import { Choice, FlowCard, Stepper, field, primaryBtn, secondaryBtn } from "./Flow";
import { Help } from "./Help";
import { BarList, Heatmap } from "./charts";
import { METRIC_WORDS, type AccountPlan } from "@/lib/v2-shared";

type Metric = { metric: string; price_usdt: number; kind: string; description: string };
type KeyOpt = { id: number; label: string; hint: string; balanceUsdt: number };
type Row = Record<string, unknown>;
type Result = { ok: boolean; metric?: string; kind?: string; as_of?: string; stale?: boolean; billed_usdt?: number; data?: { symbols?: Row[]; disclaimer?: string; has_baseline?: boolean }; error?: string; message?: string; actions?: { action: string; until?: string }[] };

const STEPS = ["What", "Which market", "Price & run", "Result"];
const pctFmt = (v: number) => `${(v * 100).toFixed(2)}%`;
const money = (v: number) => (Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);

function toCsv(head: string[], rows: (string | number | null)[][]) {
  const esc = (v: unknown) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [head, ...rows].map((r) => r.map(esc).join(",")).join("\n");
}

export function DataFlow({ metrics, keys, plan }: { metrics: Metric[]; keys: KeyOpt[]; plan: AccountPlan | null }) {
  const [step, setStep] = useState(0);
  const [metric, setMetric] = useState<string>("");
  const [universe, setUniverse] = useState<string[] | null>(null);
  const [uErr, setUErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [symbol, setSymbol] = useState<string>("");
  const [keyId, setKeyId] = useState<number | null>(keys[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const m = metrics.find((x) => x.metric === metric);
  const words = METRIC_WORDS[metric];
  const filtered = useMemo(() => (universe ?? []).filter((s) => s.toLowerCase().includes(q.toLowerCase())).slice(0, 60), [universe, q]);
  const planCovers = plan ? plan.windows.session.usedUu + 10 <= plan.windows.session.capUu && plan.windows.weekly.usedUu + 10 <= plan.windows.weekly.capUu : false;

  async function toStep2() {
    setStep(1);
    setUniverse(null);
    setUErr(null);
    const r = await fetch(`/api/console/universe?metric=${metric}`);
    const j = await r.json().catch(() => null);
    if (r.ok && j?.symbols) setUniverse(j.symbols);
    else setUErr(j?.error === "warming_up" ? "This data is still being prepared. Try again in a minute." : "Couldn't load the list of markets.");
  }

  async function run() {
    if (!keyId) return;
    setBusy(true);
    const r = await fetch(`/api/console/me/intelligence/${metric}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keyId }) });
    const j = (await r.json().catch(() => ({ ok: false, error: "bad_response" }))) as Result;
    setBusy(false);
    setResult(j);
    setStep(3);
  }

  const rows = (result?.data?.symbols ?? []) as Row[];
  const mine = rows.filter((r) => r.symbol === symbol);

  // One factual sentence per metric. Describes what the numbers are; never advises.
  function summary(): string {
    if (!mine.length) return `No ${symbol} data in this snapshot.`;
    if (metric === "funding-rate-heatmap") {
      const per = ((mine[0].per_exchange as Row[]) ?? []).map((e) => ({ ex: String(e.exchange), apr: Number(e.funding_apr) }));
      if (!per.length) return `No exchange rates for ${symbol}.`;
      const hi = per.reduce((a, b) => (b.apr > a.apr ? b : a));
      const lo = per.reduce((a, b) => (b.apr < a.apr ? b : a));
      return `Across ${per.length} exchange${per.length > 1 ? "s" : ""}, annualised funding for ${symbol} ranges from ${pctFmt(lo.apr)} (${lo.ex}) to ${pctFmt(hi.apr)} (${hi.ex}).`;
    }
    if (metric === "open-interest-shifts") {
      const r = mine[0];
      return r.change_pct === null ? `Open interest in ${symbol} is ${money(Number(r.open_interest_usd))}; there is no earlier snapshot to compare yet.` : `Open interest in ${symbol} is ${money(Number(r.open_interest_usd))}, ${Number(r.change_pct) >= 0 ? "up" : "down"} ${pctFmt(Math.abs(Number(r.change_pct)))} since the previous snapshot.`;
    }
    if (metric === "liquidation-clusters") return `Model estimate from the mark price (${money(Number(mine[0].mark_price))}) and funding — not measured liquidation orders.`;
    const tight = mine.reduce((a, b) => (Number(b.spread_bps) < Number(a.spread_bps) ? b : a));
    return `${symbol} spread is ${Number(tight.spread_bps).toFixed(2)} bps on ${tight.exchange}${mine.length > 1 ? `, the tightest of ${mine.length} venues` : ""}.`;
  }

  function tableFor(): { head: string[]; rows: (string | number | null)[][] } {
    if (metric === "funding-rate-heatmap") return { head: ["Exchange", "Funding (annualised)", "Rate per interval"], rows: ((mine[0]?.per_exchange as Row[]) ?? []).map((e) => [String(e.exchange), pctFmt(Number(e.funding_apr)), Number(e.funding_rate)]) };
    if (metric === "open-interest-shifts") return { head: ["Symbol", "Open interest (USD)", "Previous", "Change"], rows: mine.map((r) => [String(r.symbol), Number(r.open_interest_usd), r.prior_open_interest_usd as number | null, r.change_pct === null ? null : pctFmt(Number(r.change_pct))]) };
    if (metric === "liquidation-clusters") return { head: ["Side", "Leverage", "Price"], rows: ((mine[0]?.clusters as Row[]) ?? []).map((c) => [String(c.side).replace("_", " "), `${c.leverage}×`, Number(c.price)]) };
    return { head: ["Exchange", "Spread (bps)", "Bid depth", "Ask depth", "Imbalance"], rows: mine.map((r) => [String(r.exchange), Number(r.spread_bps), Number(r.bid_depth_usd), Number(r.ask_depth_usd), r.depth_imbalance as number | null]) };
  }

  function chart() {
    if (!mine.length) return null;
    if (metric === "funding-rate-heatmap") {
      const per = ((mine[0].per_exchange as Row[]) ?? []);
      return <Heatmap title={`${symbol} funding by exchange (annualised)`} rows={[symbol]} cols={per.map((e) => String(e.exchange))} value={(_r, c) => { const e = per.find((x) => x.exchange === c); return e ? Number(e.funding_apr) : null; }} fmt={pctFmt} mode="diverging" />;
    }
    if (metric === "open-interest-shifts") {
      const top = [...rows].filter((r) => r.change_pct !== null).sort((a, b) => Math.abs(Number(b.change_pct)) - Math.abs(Number(a.change_pct))).slice(0, 8);
      return <BarList title="Largest open-interest moves (absolute %)" items={top.map((r) => ({ label: `${r.symbol}${Number(r.change_pct) < 0 ? " ↓" : " ↑"}`, value: Math.abs(Number(r.change_pct)) }))} fmt={pctFmt} caption="Arrows show direction; bar length is the size of the change." />;
    }
    if (metric === "liquidation-clusters") {
      const cl = ((mine[0].clusters as Row[]) ?? []);
      return <BarList title={`${symbol} estimated liquidation prices by leverage (model)`} items={cl.map((c) => ({ label: `${c.leverage}× ${String(c.side).startsWith("long") ? "long" : "short"}`, value: Number(c.price) }))} fmt={(v) => money(v)} caption="Labelled model: derived from public mark price and funding, not measured exchange orders." />;
    }
    return <BarList title={`${symbol} spread by venue (bps)`} items={mine.map((r) => ({ label: String(r.exchange), value: Number(r.spread_bps) }))} fmt={(v) => v.toFixed(2)} />;
  }

  const apiCall = `curl https://api.satelink.network/v1/intelligence/${metric} -H "X-API-Key: <your key>"`;

  return (
    <div className="mx-auto max-w-2xl">
      <Stepper steps={STEPS} current={step} />
      {step === 0 && (
        <FlowCard title="What do you want to look at?" lede="Pick a kind of market data. You'll see the price before anything is charged.">
          <fieldset className="space-y-2">
            <legend className="sr-only">Market data</legend>
            {metrics.map((x) => (
              <Choice key={x.metric} name="metric" value={x.metric} checked={metric === x.metric} onChange={setMetric}
                title={METRIC_WORDS[x.metric]?.title ?? x.metric} detail={METRIC_WORDS[x.metric]?.question ?? x.description} />
            ))}
          </fieldset>
          {metrics.length === 0 && <p className="text-sl-text-muted">Market data is unavailable right now.</p>}
          <div className="mt-6 flex justify-end"><button type="button" className={primaryBtn} disabled={!metric} onClick={toStep2}>Continue</button></div>
        </FlowCard>
      )}
      {step === 1 && (
        <FlowCard title="Which market?" lede={words?.title}>
          <label className="block">
            <span className="mb-1 block text-[13px] text-sl-text-muted">Search markets</span>
            <input className={field} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. BTC" autoFocus />
          </label>
          {uErr && <p role="alert" className="mt-3 text-sl-down">{uErr}</p>}
          {!universe && !uErr && <p className="mt-3 text-sl-text-muted" role="status">Loading markets…</p>}
          {universe && (
            <fieldset className="mt-3 grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
              <legend className="sr-only">Markets</legend>
              {filtered.map((s) => <Choice key={s} name="symbol" value={s} checked={symbol === s} onChange={setSymbol} title={s} />)}
              {filtered.length === 0 && <p className="col-span-full text-sl-text-muted">No market matches “{q}”.</p>}
            </fieldset>
          )}
          <div className="mt-6 flex justify-between">
            <button type="button" className={secondaryBtn} onClick={() => setStep(0)}>Back</button>
            <button type="button" className={primaryBtn} disabled={!symbol} onClick={() => setStep(2)}>Continue</button>
          </div>
        </FlowCard>
      )}
      {step === 2 && (
        <FlowCard title="Check the price, then run" lede={`${words?.title} · ${symbol}`}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[15px]">
            <dt className="text-sl-text-muted">Price</dt>
            <dd className="text-sl-text">${m?.price_usdt.toFixed(2)} per request <span className="text-sl-text-muted">(10 UU<Help term="UU" label="What's UU?" />)</span></dd>
            <dt className="text-sl-text-muted">Paid from</dt>
            <dd className="text-sl-text">{planCovers ? "Your plan allowance — no extra charge" : plan && plan.packBalanceUu >= 10 ? "Your credit pack" : "Your crypto credits, if auto-use is on"}</dd>
          </dl>
          {keys.length === 0 ? (
            <p className="mt-5 text-sl-text-muted">You need a key that can use market data first. <Link className="text-sl-accent underline" href="/agents/new">Create one</Link>.</p>
          ) : (
            <label className="mt-5 block">
              <span className="mb-1 block text-[13px] text-sl-text-muted">Charge it to<Help term="API key" label="What's a key?" /></span>
              <select className={field} value={keyId ?? ""} onChange={(e) => setKeyId(Number(e.target.value))}>
                {keys.map((k) => <option key={k.id} value={k.id}>{k.label} ({k.hint})</option>)}
              </select>
            </label>
          )}
          <div className="mt-6 flex justify-between">
            <button type="button" className={secondaryBtn} onClick={() => setStep(1)}>Back</button>
            <button type="button" className={primaryBtn} disabled={!keyId || busy} onClick={run}>{busy ? "Running…" : `Run for $${m?.price_usdt.toFixed(2)}`}</button>
          </div>
        </FlowCard>
      )}
      {step === 3 && result && (
        <FlowCard title={result.ok ? `${words?.title}: ${symbol}` : "That didn't run"}>
          {!result.ok ? (
            <div role="alert">
              <p className="text-sl-text">{result.message ?? (result.error === "warming_up" ? "The data is still being prepared. Nothing was charged for the data you didn't get — try again shortly." : "The request was refused.")}</p>
              {result.actions && (
                <ul className="mt-3 list-disc pl-5 text-sl-text-muted">
                  {result.actions.map((a) => <li key={a.action}>{a.action === "wait" ? `Wait until ${a.until ? new Date(a.until).toLocaleString() : "the window resets"}` : a.action === "enable_credits" ? <Link className="underline" href="/settings#spending">Turn on credit auto-use</Link> : <Link className="underline" href="/billing/add">Upgrade your plan</Link>}</li>)}
                </ul>
              )}
              <div className="mt-6"><button type="button" className={secondaryBtn} onClick={() => setStep(2)}>Back</button></div>
            </div>
          ) : (
            <>
              <p className="text-[16px] text-sl-text" data-testid="summary">{summary()}</p>
              <p className="mt-1 text-[12px] text-sl-text-subtle">As of {result.as_of ? new Date(result.as_of).toLocaleString() : "now"}{result.stale ? " · this snapshot is older than usual" : ""} · charged ${Number(result.billed_usdt ?? 0).toFixed(2)}. Market data, not advice.</p>
              <div className="mt-5">{chart()}</div>
              <div className="mt-6 flex flex-wrap gap-2">
                <button type="button" className={secondaryBtn} disabled={saved} onClick={async () => {
                  const r = await fetch("/api/console/me/saved-queries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: `${words?.title} · ${symbol}`, query: { kind: "intelligence", metric, symbol } }) });
                  setSaved(r.ok);
                }}><Save aria-hidden className="size-4" />{saved ? "Saved" : "Save"}</button>
                <button type="button" className={secondaryBtn} onClick={() => {
                  const t = tableFor();
                  const url = URL.createObjectURL(new Blob([toCsv(t.head, t.rows)], { type: "text/csv" }));
                  const a = document.createElement("a"); a.href = url; a.download = `${metric}-${symbol}.csv`; a.click(); URL.revokeObjectURL(url);
                }}><Download aria-hidden className="size-4" />Download CSV</button>
                <button type="button" className={secondaryBtn} onClick={async () => { await navigator.clipboard.writeText(apiCall); setCopied(true); }}><Copy aria-hidden className="size-4" />{copied ? "Copied" : "Copy API call"}</button>
                <button type="button" className={primaryBtn} onClick={() => { setResult(null); setSaved(false); setStep(0); }}>Done</button>
              </div>
            </>
          )}
        </FlowCard>
      )}
    </div>
  );
}
