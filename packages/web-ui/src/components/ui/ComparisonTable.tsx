// ComparisonTable — factual feature comparison. Every cell is a verifiable
// value or a boolean (rendered as a check / dash), never a marketing claim.
// The "own" column (highlightColumn index) gets an accent-tinted background.
import * as React from "react";
import { Check, Minus } from "lucide-react";
import { cn } from "../../lib/utils";

export type Cell = string | boolean;

export interface ComparisonTableProps {
  columns: string[];
  rows: { label: string; cells: Cell[] }[];
  highlightColumn?: number; // index into columns (0-based)
  className?: string;
}

function renderCell(c: Cell) {
  if (c === true) return <Check className="mx-auto size-4 text-sl-up" aria-label="Yes" />;
  if (c === false) return <Minus className="mx-auto size-4 text-sl-text-subtle" aria-label="No" />;
  return <span className="tabular-nums">{c}</span>;
}

export function ComparisonTable({ columns, rows, highlightColumn, className }: ComparisonTableProps) {
  return (
    <div className={cn("overflow-x-auto rounded-[var(--sl-radius-lg)] border border-sl-border", className)}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th
                key={c}
                className={cn(
                  "border-b border-sl-border px-4 py-3 font-semibold text-sl-text",
                  i === 0 ? "text-left" : "text-center",
                  i === highlightColumn && "bg-sl-accent-soft text-sl-accent"
                )}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td className="border-b border-sl-border px-4 py-3 text-left font-medium text-sl-text-muted">
                {row.label}
              </td>
              {row.cells.map((cell, i) => (
                <td
                  key={i}
                  className={cn(
                    "border-b border-sl-border px-4 py-3 text-center text-sl-text-muted",
                    i + 1 === highlightColumn && "bg-sl-accent-soft/60"
                  )}
                >
                  {renderCell(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
