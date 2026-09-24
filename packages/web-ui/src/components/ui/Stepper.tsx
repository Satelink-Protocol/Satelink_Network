// Stepper — numbered progress indicator for the checkout flow
// (1 Account · 2 Review · 3 Pay). Presentational; `current` is 1-indexed.
import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "../../lib/utils";

export interface StepperProps {
  steps: string[];
  current: number; // 1-indexed
  className?: string;
}

export function Stepper({ steps, current, className }: StepperProps) {
  return (
    <ol className={cn("flex items-center gap-2", className)}>
      {steps.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <li key={label} className="flex flex-1 items-center gap-2 last:flex-none">
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums",
                  done && "bg-sl-accent text-sl-accent-ink",
                  active && "border-2 border-sl-accent text-sl-accent",
                  !done && !active && "border border-sl-border text-sl-text-subtle"
                )}
                aria-current={active ? "step" : undefined}
              >
                {done ? <Check className="size-3.5" /> : n}
              </span>
              <span
                className={cn(
                  "text-sm font-medium",
                  active ? "text-sl-text" : "text-sl-text-subtle"
                )}
              >
                {label}
              </span>
            </span>
            {n < steps.length && <span aria-hidden className="h-px flex-1 bg-sl-border" />}
          </li>
        );
      })}
    </ol>
  );
}
