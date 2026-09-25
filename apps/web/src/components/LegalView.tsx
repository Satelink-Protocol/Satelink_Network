// Shared renderer for the policy pages (web-v3 P4). Every policy carries:
//   • a plain-English summary box at the top,
//   • a "Draft pending legal review" banner (these are CMS Review-state drafts),
//   • a last-updated date + version,
//   • numbered sections (with optional lists and tables),
//   • a version history.
import * as React from "react";
import { LEGAL_UPDATED, type LegalDoc } from "@/lib/legal";

function fmt(d: string) {
  return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export function LegalView({ doc }: { doc: LegalDoc }) {
  const updated = doc.updated ?? LEGAL_UPDATED;
  return (
    <article className="mx-auto max-w-[820px] px-4 py-16 sm:px-6">
      <h1 className="font-sl-display text-3xl font-normal tracking-tight text-sl-text sm:text-4xl">{doc.title}</h1>
      <p className="mt-2 text-xs text-sl-text-subtle">
        Version {doc.version} · Last updated {fmt(updated)}
      </p>

      {/* Draft banner — these are CMS Review-state drafts pending counsel */}
      <div
        role="note"
        data-legal-draft
        className="mt-4 rounded-[var(--sl-radius)] border border-sl-warn/40 bg-sl-warn/10 p-3 text-sm text-sl-text-muted"
      >
        <strong className="font-semibold text-sl-text">Draft pending legal review.</strong>{" "}
        This policy reflects how Satelink operates today and is written to the applicable Indian and
        international data-protection standards; it is not yet approved by counsel.
      </div>

      {/* Plain-English summary box */}
      {doc.summary?.length ? (
        <div data-legal-summary className="mt-6 rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-bg-raised p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-sl-accent">In plain English</p>
          <ul className="mt-3 space-y-2">
            {doc.summary.map((s, i) => (
              <li key={i} className="flex gap-2.5 text-sm text-sl-text-muted">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-sl-accent" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-6 text-base leading-relaxed text-sl-text-muted">{doc.intro}</p>

      {doc.sections.map((s, idx) => (
        <section key={s.heading} className="mt-8">
          <h2 className="text-lg font-semibold text-sl-text">
            <span className="mr-2 font-sl-mono text-sl-text-subtle">{idx + 1}.</span>
            {s.heading}
          </h2>
          {s.body?.map((p, i) => (
            <p key={i} className="mt-2 text-sm leading-relaxed text-sl-text-muted">{p}</p>
          ))}
          {s.list?.length ? (
            <ul className="mt-3 space-y-1.5">
              {s.list.map((li, i) => (
                <li key={i} className="flex gap-2.5 text-sm text-sl-text-muted">
                  <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-sl-text-subtle" />
                  <span>{li}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {s.table ? (
            <div className="mt-3 overflow-x-auto rounded-[var(--sl-radius)] border border-sl-border">
              <table className="w-full min-w-[480px] border-collapse text-sm">
                <thead>
                  <tr>
                    {s.table.headers.map((h) => (
                      <th key={h} className="border-b border-sl-border bg-sl-bg-raised px-3 py-2 text-left font-semibold text-sl-text">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.table.rows.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => (
                        <td key={ci} className="border-b border-sl-border px-3 py-2 align-top text-sl-text-muted">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ))}

      {doc.versionHistory?.length ? (
        <section className="mt-12 border-t border-sl-border pt-6">
          <h2 className="text-sm font-semibold text-sl-text">Version history</h2>
          <ul className="mt-3 space-y-1.5">
            {doc.versionHistory.map((v) => (
              <li key={v.version} className="text-xs text-sl-text-subtle">
                <span className="font-sl-mono">v{v.version}</span> · {fmt(v.date)} — {v.note}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
