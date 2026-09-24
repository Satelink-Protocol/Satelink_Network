// Badge — small status/label pill. Variants: live, planned, model, neutral,
// up, down. `model` is reserved for modelled/proxy data (--sl-model).
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-[var(--sl-radius-pill)] px-2.5 py-0.5 text-xs font-semibold leading-5 tracking-tight",
  {
    variants: {
      variant: {
        live: "bg-sl-accent-soft text-sl-accent",
        planned: "bg-sl-surface text-sl-text-subtle border border-sl-border",
        model: "bg-[color-mix(in_srgb,var(--sl-model)_15%,transparent)] text-sl-model",
        neutral: "bg-sl-surface text-sl-text-muted border border-sl-border",
        up: "bg-[color-mix(in_srgb,var(--sl-up)_15%,transparent)] text-sl-up",
        down: "bg-[color-mix(in_srgb,var(--sl-down)_15%,transparent)] text-sl-down",
      },
    },
    defaultVariants: { variant: "neutral" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

export function Badge({ className, variant, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && (
        <span aria-hidden className="size-1.5 rounded-full bg-current" />
      )}
      {children}
    </span>
  );
}
