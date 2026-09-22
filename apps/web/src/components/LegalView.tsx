// Shared renderer for the policy pages (§8). Carries an "under review" note
// (these are published as Review) and the last-updated date.
import * as React from "react";
import { LEGAL_UPDATED, type LegalDoc } from "@/lib/legal";

export function LegalView({ doc }: { doc: LegalDoc }) {
  return (
    <article className="mx-auto max-w-[760px] px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-sl-text">{doc.title}</h1>
      <p className="mt-2 text-xs text-sl-text-subtle">Last updated {new Date(LEGAL_UPDATED).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</p>
      <div className="mt-4 rounded-[var(--sl-radius)] border border-sl-warn/40 bg-sl-warn/10 p-3 text-sm text-sl-text-muted">
        This policy is under review. It reflects how Satelink operates today; the final terms will be published here.
      </div>
      <p className="mt-6 text-base leading-relaxed text-sl-text-muted">{doc.intro}</p>
      {doc.sections.map((s) => (
        <section key={s.heading} className="mt-8">
          <h2 className="text-lg font-semibold text-sl-text">{s.heading}</h2>
          {s.body.map((p, i) => (
            <p key={i} className="mt-2 text-sm leading-relaxed text-sl-text-muted">{p}</p>
          ))}
        </section>
      ))}
    </article>
  );
}
