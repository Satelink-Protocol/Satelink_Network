// CompareMatrix — the full feature-comparison table (§4.2/§4.6). Config-driven
// from lib/plans.ts (COMPARE_GROUPS): grouped rows, sticky header, no hardcoded
// numbers in JSX. The Pro column is highlighted as the recommended plan.
import { Fragment } from "react";
import { Check, Minus } from "lucide-react";
import { PLANS, COMPARE_GROUPS, type CompareValue } from "@/lib/plans";

function Cell({ v }: { v: CompareValue }) {
  if (v === true) return <Check className="mx-auto size-4 text-sl-accent" aria-label="Included" />;
  if (v === false) return <Minus className="mx-auto size-4 text-sl-text-subtle" aria-label="Not included" />;
  return <span className="font-sl-mono text-sm tabular-nums text-sl-text">{v}</span>;
}

export function CompareMatrix() {
  const cols = PLANS.map((p) => p.name);
  const proIndex = PLANS.findIndex((p) => p.featured);

  return (
    <div className="overflow-x-auto rounded-[var(--sl-radius-lg)] border border-sl-border">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-sl-surface">
          <tr>
            <th className="border-b border-sl-border px-4 py-3 text-left font-semibold text-sl-text">Feature</th>
            {cols.map((c, i) => (
              <th
                key={c}
                className={`border-b border-sl-border px-4 py-3 text-center font-semibold ${i === proIndex ? "text-sl-accent" : "text-sl-text"}`}
              >
                {c}
                {i === proIndex && <span className="ml-1 text-[0.625rem] uppercase">· rec</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COMPARE_GROUPS.map((g) => (
            <Fragment key={g.group}>
              <tr>
                <th
                  colSpan={cols.length + 1}
                  className="bg-sl-bg-raised px-4 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-sl-text-subtle"
                >
                  {g.group}
                </th>
              </tr>
              {g.rows.map((row) => (
                <tr key={row.label}>
                  <td className="border-b border-sl-border px-4 py-3 text-sl-text-muted">{row.label}</td>
                  {row.values.map((v, i) => (
                    <td
                      key={i}
                      className={`border-b border-sl-border px-4 py-3 text-center ${i === proIndex ? "bg-sl-accent-soft" : ""}`}
                    >
                      <Cell v={v} />
                    </td>
                  ))}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
