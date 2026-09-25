"use client";
// Dependency-free SVG charts for the console (bundle budget: 0 kB of chart
// library). The API returns daily series and point-in-time snapshots — no OHLC
// — so there are no candlesticks; line/area, ranked bars, heatmaps and meters
// cover every panel. Rules (dataviz method): one y-axis, 2px lines, rounded
// bar ends on the baseline, 2px gaps, recessive grid, legend for ≥2 series,
// text in text tokens (never series colour), hover tooltip on every plot, and a
// table view for every chart.
import { useId, useMemo, useState } from "react";

export const SERIES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"];
const fmtDefault = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 4 });
/** Serializable formatter presets, for charts rendered from Server Components
 *  (a function prop cannot cross the server → client boundary). */
export type FormatPreset = "usd2" | "usd4" | "pct" | "int";
const PRESETS: Record<FormatPreset, (v: number) => string> = {
  usd2: (v) => `$${v.toFixed(2)}`,
  usd4: (v) => `$${v.toFixed(4)}`,
  pct: (v) => `${(v * 100).toFixed(2)}%`,
  int: (v) => Math.round(v).toLocaleString("en-US"),
};

function Frame({ title, caption, table, children }: { title: string; caption?: string; table: { head: string[]; rows: (string | number)[][] }; children: React.ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  const id = useId();
  return (
    <figure className="min-w-0" aria-labelledby={id}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <figcaption id={id} className="text-[13px] font-medium text-sl-text">{title}</figcaption>
        <button type="button" onClick={() => setAsTable((t) => !t)} className="text-[11px] text-sl-text-muted underline-offset-2 hover:underline">
          {asTable ? "Show chart" : "Show table"}
        </button>
      </div>
      {asTable ? (
        <div className="max-h-64 overflow-auto" tabIndex={0} role="region" aria-label={`${title} table`}>
          <table className="tnum w-full text-left text-[12px]">
            <thead><tr>{table.head.map((h) => <th key={h} scope="col" className="border-b border-sl-border px-1.5 py-1 font-medium text-sl-text-muted">{h}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="border-b border-sl-border/50 px-1.5 py-1 text-sl-text">{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : children}
      {caption && <p className="mt-1.5 text-[11px] text-sl-text-subtle">{caption}</p>}
    </figure>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  if (items.length < 2) return null;
  return (
    <ul className="mb-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-sl-text-muted">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-3 rounded" style={{ background: it.color }} />{it.label}</li>
      ))}
    </ul>
  );
}

export type Series = { label: string; values: number[] };

export function LineChart({ title, x, series, fmt = fmtDefault, height = 180, area = false, caption }: { title: string; x: string[]; series: Series[]; fmt?: (v: number) => string; height?: number; area?: boolean; caption?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 600;
  const H = height;
  const pad = { l: 44, r: 8, t: 8, b: 20 };
  const max = Math.max(1e-9, ...series.flatMap((s) => s.values));
  const sx = (i: number) => pad.l + (x.length <= 1 ? 0 : (i / (x.length - 1)) * (W - pad.l - pad.r));
  const sy = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const ticks = [0, max / 2, max];
  const shown = series.slice(0, 4);
  return (
    <Frame title={title} caption={caption} table={{ head: ["Date", ...shown.map((s) => s.label)], rows: x.map((d, i) => [d, ...shown.map((s) => fmt(s.values[i] ?? 0))]) }}>
      <Legend items={shown.map((s, i) => ({ label: s.label, color: SERIES[i] }))} />
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${title}: ${shown.map((s) => `${s.label} latest ${fmt(s.values.at(-1) ?? 0)}`).join("; ")}`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const r = (e.currentTarget as SVGElement).getBoundingClientRect();
            const px = ((e.clientX - r.left) / r.width) * W;
            const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (x.length - 1));
            setHover(Math.max(0, Math.min(x.length - 1, i)));
          }}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} stroke="var(--chart-grid)" strokeWidth={1} />
              <text x={pad.l - 6} y={sy(t) + 3} textAnchor="end" className="fill-sl-text-subtle text-[10px]">{fmt(t)}</text>
            </g>
          ))}
          {x.length > 0 && [0, x.length - 1].map((i) => (
            <text key={i} x={sx(i)} y={H - 4} textAnchor={i === 0 ? "start" : "end"} className="fill-sl-text-subtle text-[10px]">{x[i]}</text>
          ))}
          {shown.map((s, si) => {
            const d = s.values.map((v, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(" ");
            return (
              <g key={s.label}>
                {area && <path d={`${d} L${sx(s.values.length - 1)},${sy(0)} L${sx(0)},${sy(0)} Z`} fill={SERIES[si]} opacity={0.12} />}
                <path d={d} fill="none" stroke={SERIES[si]} strokeWidth={2} strokeLinejoin="round" />
              </g>
            );
          })}
          {hover !== null && (
            <g>
              <line x1={sx(hover)} x2={sx(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--sl-border-strong)" strokeDasharray="3 3" />
              {shown.map((s, si) => <circle key={s.label} cx={sx(hover)} cy={sy(s.values[hover] ?? 0)} r={4} fill={SERIES[si]} stroke="var(--sl-surface)" strokeWidth={2} />)}
            </g>
          )}
        </svg>
        {hover !== null && (
          <div role="status" className="pointer-events-none absolute top-1 rounded-[var(--sl-radius-sm)] border border-sl-border bg-sl-surface px-2 py-1 text-[11px] shadow-[var(--sl-shadow-2)]" style={{ left: `${Math.min(70, (sx(hover) / W) * 100)}%` }}>
            <p className="text-sl-text-muted">{x[hover]}</p>
            {shown.map((s, si) => <p key={s.label} className="tnum text-sl-text"><span aria-hidden className="mr-1 inline-block size-2 rounded-full" style={{ background: SERIES[si] }} />{s.label}: {fmt(s.values[hover] ?? 0)}</p>)}
          </div>
        )}
      </div>
    </Frame>
  );
}

export function BarList({ title, items, fmt: fmtFn, format, caption, color = SERIES[0] }: { title: string; items: { label: string; value: number }[]; fmt?: (v: number) => string; format?: FormatPreset; caption?: string; color?: string }) {
  const fmt = fmtFn ?? (format ? PRESETS[format] : fmtDefault);
  const max = Math.max(1e-9, ...items.map((i) => i.value));
  return (
    <Frame title={title} caption={caption} table={{ head: ["Name", "Value"], rows: items.map((i) => [i.label, fmt(i.value)]) }}>
      <ul className="space-y-[2px]">
        {items.map((it) => (
          <li key={it.label} className="group grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-2 text-[12px]" title={`${it.label}: ${fmt(it.value)}`}>
            <span className="truncate text-sl-text-muted">{it.label}</span>
            <span className="h-3.5 rounded-r-[4px] bg-sl-bg-raised">
              <span className="block h-full rounded-r-[4px] transition-opacity group-hover:opacity-80" style={{ width: `${(it.value / max) * 100}%`, background: color, minWidth: it.value > 0 ? 2 : 0 }} />
            </span>
            <span className="tnum text-sl-text">{fmt(it.value)}</span>
          </li>
        ))}
      </ul>
    </Frame>
  );
}

/** rows × cols grid. mode 'sequential' (0→max, one hue) or 'diverging' (−max…+max around grey). */
export function Heatmap({ title, rows, cols, value, fmt = fmtDefault, mode = "sequential", caption }: { title: string; rows: string[]; cols: string[]; value: (r: string, c: string) => number | null; fmt?: (v: number) => string; mode?: "sequential" | "diverging"; caption?: string }) {
  const [hover, setHover] = useState<{ r: string; c: string; v: number | null } | null>(null);
  const vals = useMemo(() => rows.flatMap((r) => cols.map((c) => value(r, c))).filter((v): v is number => v !== null), [rows, cols, value]);
  const max = Math.max(1e-12, ...vals.map((v) => Math.abs(v)));
  const fill = (v: number | null) => {
    if (v === null) return "transparent";
    // Capped at 45% so body-coloured text in the cell keeps AA contrast in both
    // themes; exact values are in the cell text and the table view.
    if (mode === "sequential") return `color-mix(in oklab, var(--chart-1) ${Math.round(6 + (v / max) * 39)}%, var(--sl-surface))`;
    const t = Math.round((Math.abs(v) / max) * 45);
    return `color-mix(in oklab, ${v >= 0 ? "var(--chart-pos)" : "var(--chart-neg)"} ${t}%, var(--chart-mid))`;
  };
  return (
    <Frame title={title} caption={caption} table={{ head: ["", ...cols], rows: rows.map((r) => [r, ...cols.map((c) => { const v = value(r, c); return v === null ? "n/a" : fmt(v); })]) }}>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`${title} grid`}>
        <table className="tnum border-separate text-[11px]" style={{ borderSpacing: 2 }}>
          <thead><tr><th />{cols.map((c) => <th key={c} scope="col" className="px-1 font-normal text-sl-text-muted">{c}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r}>
                <th scope="row" className="pr-2 text-left font-normal text-sl-text-muted">{r}</th>
                {cols.map((c) => {
                  const v = value(r, c);
                  return (
                    <td key={c} onMouseEnter={() => setHover({ r, c, v })} onMouseLeave={() => setHover(null)}
                      className="h-6 min-w-12 rounded-[3px] text-center text-sl-text" style={{ background: fill(v), outline: v === null ? "1px dashed var(--sl-border)" : undefined }}>
                      <span className="sr-only">{r} {c}: </span>{v === null ? "" : fmt(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hover && <p role="status" className="mt-1 text-[11px] text-sl-text-muted">{hover.r} · {hover.c}: <span className="tnum text-sl-text">{hover.v === null ? "no data" : fmt(hover.v)}</span></p>}
    </Frame>
  );
}

/** Usage meter for an allowance window (session / weekly). */
export function Meter({ label, used, cap, unit = "UU", hint }: { label: string; used: number; cap: number; unit?: string; hint?: string }) {
  const p = cap > 0 ? Math.min(100, (used / cap) * 100) : 0;
  const tone = p >= 95 ? "var(--sl-down)" : p >= 85 ? "var(--sl-warn)" : "var(--chart-1)";
  return (
    <div>
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="text-sl-text">{label}</span>
        <span className="tnum text-sl-text-muted">{used.toLocaleString()} / {cap.toLocaleString()} {unit} · {Math.round(p)}%</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-sl-bg-raised" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={cap} aria-valuenow={used}>
        <div className="h-2 rounded-full" style={{ width: `${p}%`, background: tone, minWidth: used > 0 ? 4 : 0 }} />
      </div>
      {hint && <p className="mt-1 text-[11px] text-sl-text-subtle">{hint}</p>}
    </div>
  );
}

export function Spark({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const W = 96, H = 28, max = Math.max(1e-9, ...values);
  const d = values.map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * W).toFixed(1)},${(H - 2 - (v / max) * (H - 4)).toFixed(1)}`).join(" ");
  return <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label} trend`}><path d={d} fill="none" stroke="var(--chart-1)" strokeWidth={2} /></svg>;
}

export function Stat({ label, value, hint, spark }: { label: string; value: string | null; hint?: string; spark?: number[] }) {
  return (
    <div className="rounded-[var(--sl-radius)] border border-sl-border bg-sl-surface p-3">
      <p className="text-[12px] text-sl-text-muted">{label}</p>
      <div className="mt-1 flex items-end justify-between gap-2">
        <p className="tnum text-[22px] font-medium leading-none text-sl-text">{value ?? <span className="text-[13px] font-normal text-sl-text-subtle">No data yet</span>}</p>
        {spark && <Spark values={spark} label={label} />}
      </div>
      {hint && <p className="mt-1.5 text-[11px] text-sl-text-subtle">{hint}</p>}
    </div>
  );
}
