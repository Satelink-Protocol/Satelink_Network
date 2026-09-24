// Dense operator-UI primitives. Numbers use tabular figures. Absent data is a
// designed state (Empty) — never "—", never a placeholder number.
import Link from "next/link";

export function PageHeader({ title, lede, actions }: { title: string; lede?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-sl-border pb-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-sl-text">{title}</h1>
        {lede && <p className="mt-0.5 text-sl-text-muted">{lede}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, action, children, className = "" }: { title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-md border border-sl-border bg-sl-surface ${className}`}>
      {title && (
        <header className="flex items-center justify-between border-b border-sl-border px-3 py-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-sl-text-muted">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-3">{children}</div>
    </section>
  );
}

export function Kpi({ label, value, hint, spark }: { label: string; value: React.ReactNode | null; hint?: string; spark?: number[] }) {
  return (
    <div className="rounded-md border border-sl-border bg-sl-surface px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wider text-sl-text-subtle">{label}</p>
      {value === null ? (
        <p className="mt-1 text-sl-text-subtle">No data yet</p>
      ) : (
        <div className="mt-1 flex items-end justify-between gap-2">
          <p className="tnum text-xl font-semibold text-sl-text">{value}</p>
          {spark && spark.length > 1 && <Sparkline values={spark} />}
        </div>
      )}
      {hint && <p className="mt-0.5 text-[11px] text-sl-text-subtle">{hint}</p>}
    </div>
  );
}

export function Sparkline({ values, width = 84, height = 24 }: { values: number[]; width?: number; height?: number }) {
  const max = Math.max(...values) || 1;
  const step = width / Math.max(values.length - 1, 1);
  const d = values.map((v, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${(height - (v / max) * (height - 2) - 1).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="text-sl-accent">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}

export function Empty({ title, body, cta }: { title: string; body: string; cta?: { label: string; href: string } }) {
  return (
    <div className="flex flex-col items-start gap-1 rounded-md border border-dashed border-sl-border px-4 py-6">
      <p className="font-medium text-sl-text">{title}</p>
      <p className="max-w-prose text-sl-text-muted">{body}</p>
      {cta && (
        <Link href={cta.href} className="mt-2 rounded border border-sl-border px-2.5 py-1 text-xs font-medium text-sl-text hover:border-sl-accent">
          {cta.label}
        </Link>
      )}
    </div>
  );
}

export function ErrorNote({ what }: { what: string }) {
  return (
    <div role="status" className="rounded-md border border-sl-border bg-sl-bg-raised px-3 py-2 text-sl-text-muted">
      Couldn&apos;t load {what} from the API just now. Reload to try again.
    </div>
  );
}

export function Table({ head, children, numeric = [], label }: { head: string[]; children: React.ReactNode; numeric?: number[]; label?: string }) {
  return (
    // Focusable so keyboard users can scroll wide tables on small screens.
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={label || head.filter(Boolean).join(", ")}>
      <table className="tnum w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-sl-border text-[11px] uppercase tracking-wider text-sl-text-subtle">
            {head.map((h, i) => (
              <th key={h} scope="col" className={`px-2 py-1.5 font-medium ${numeric.includes(i) ? "text-right" : ""}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:px-2 [&_td]:py-1.5 [&_tr]:border-b [&_tr]:border-sl-border/60 [&_tr:hover]:bg-sl-surface-hover">{children}</tbody>
      </table>
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "warn" | "machine" | "market" | "settle" }) {
  // Tone is carried by the dot and border tint; the label stays body-coloured so
  // it passes contrast in both themes (several signal hues are too light as text).
  const t = {
    neutral: ["border-sl-border", "bg-sl-text-subtle"],
    good: ["border-sl-accent/40", "bg-sl-accent"],
    warn: ["border-sl-warn/50", "bg-sl-warn"],
    machine: ["border-sl-machine/50", "bg-sl-machine"],
    market: ["border-sl-market/50", "bg-sl-market"],
    settle: ["border-sl-settle/50", "bg-sl-settle"],
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-px text-[11px] font-medium text-sl-text ${t[0]}`}>
      <span aria-hidden className={`size-1.5 rounded-full ${t[1]}`} />
      {children}
    </span>
  );
}

export function NeedsKey() {
  return (
    <Empty
      title="Connect or create an API key"
      body="Console data is read with one of your Satelink API keys. Create a free key or connect one you already have."
      cta={{ label: "Go to API keys", href: "/keys" }}
    />
  );
}
