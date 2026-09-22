// Disclosure — compliance callout. Info style (accent/neutral), never
// warning-red — these are legal/clarity notes, not errors. Used on every
// Dodo surface (§2.2) and wherever a truth-rule statement must be visible.
import * as React from "react";
import { Info } from "lucide-react";
import { cn } from "../../lib/utils";

export interface DisclosureProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  icon?: React.ReactNode;
}

export function Disclosure({ title, icon, className, children, ...props }: DisclosureProps) {
  return (
    <div
      role="note"
      className={cn(
        "flex gap-3 rounded-[var(--sl-radius)] border border-sl-border bg-sl-bg-raised p-4 text-sm leading-relaxed text-sl-text-muted",
        className
      )}
      {...props}
    >
      <span aria-hidden className="mt-0.5 shrink-0 text-sl-info">
        {icon ?? <Info className="size-4" />}
      </span>
      <div className="min-w-0">
        {title && <p className="mb-1 font-semibold text-sl-text">{title}</p>}
        <div className="[&_a]:text-sl-accent [&_a]:underline [&_a]:underline-offset-2">{children}</div>
      </div>
    </div>
  );
}
