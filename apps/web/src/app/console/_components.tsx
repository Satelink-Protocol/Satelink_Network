// Shared console UI primitives (web-v3 P6). Truth rule (§7.3): no widget ever
// renders "—" or a fabricated number. Where a real endpoint doesn't exist yet
// (Track B), a widget renders <ConsoleEmpty> ("No data yet — make your first
// call") or carries a <PlannedBadge/>.
import * as React from "react";
import Link from "next/link";
import { Inbox } from "lucide-react";

export function PageHeader({ title, lede, action }: { title: string; lede?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-sl-display text-2xl font-extrabold tracking-tight text-sl-text">{title}</h1>
        {lede && <p className="mt-1 max-w-2xl text-sm text-sl-text-muted">{lede}</p>}
      </div>
      {action}
    </div>
  );
}

export function PlannedBadge({ children = "Planned" }: { children?: React.ReactNode }) {
  return (
    <span className="rounded-[var(--sl-radius-pill)] border border-sl-border px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-sl-text-subtle">
      {children}
    </span>
  );
}

export function Panel({ title, action, children }: { title?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5">
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-sm font-semibold text-sl-text">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

// Designed empty state — the only thing a data widget shows when there is no
// data yet. Never "—".
export function ConsoleEmpty({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta?: { label: string; href: string };
}) {
  return (
    <div className="flex flex-col items-center rounded-[var(--sl-radius-lg)] border border-dashed border-sl-border bg-sl-bg-raised px-6 py-12 text-center">
      <span className="mb-3 inline-flex size-11 items-center justify-center rounded-full bg-sl-surface text-sl-text-subtle">
        <Inbox className="size-5" />
      </span>
      <p className="font-semibold text-sl-text">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-sl-text-muted">{body}</p>
      {cta && (
        <Link href={cta.href} className="mt-4 rounded-[var(--sl-radius)] bg-sl-accent px-4 py-2 text-sm font-semibold text-sl-accent-ink">
          {cta.label}
        </Link>
      )}
    </div>
  );
}

// A KPI tile that shows a real value or, when there is none yet, a calm empty
// treatment — never "—".
export function KpiTile({ label, value, hint }: { label: string; value?: string | null; hint?: string }) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5">
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-sl-text-subtle">{label}</p>
      {empty ? (
        <p className="mt-2 text-sm text-sl-text-muted">No activity yet</p>
      ) : (
        <p className="mt-2 font-sl-mono text-2xl font-bold tabular-nums text-sl-text">{value}</p>
      )}
      {hint && <p className="mt-1 text-xs text-sl-text-subtle">{hint}</p>}
    </div>
  );
}
