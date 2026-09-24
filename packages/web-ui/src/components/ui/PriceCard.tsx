// PriceCard — one pricing tier. `featured` highlights the recommended tier.
// `note` renders a small line under the CTA (e.g. the crypto-rail separation).
import * as React from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { Button } from "./Button";
import { cn } from "../../lib/utils";

export interface PriceCardProps {
  tier: string;
  price: string;
  period?: string;
  blurb?: string;
  features: string[];
  cta: { label: string; href?: string; disabled?: boolean };
  featured?: boolean;
  note?: React.ReactNode;
  className?: string;
}

export function PriceCard({
  tier,
  price,
  period,
  blurb,
  features,
  cta,
  featured,
  note,
  className,
}: PriceCardProps) {
  return (
    <div
      className={cn(
        "relative flex flex-col rounded-[var(--sl-radius-lg)] border bg-sl-surface p-6",
        featured ? "border-sl-accent shadow-[var(--sl-shadow-2)]" : "border-sl-border",
        className
      )}
    >
      {featured && (
        <span className="absolute -top-2.5 left-6 rounded-[var(--sl-radius-pill)] bg-sl-accent px-2.5 py-0.5 text-[0.6875rem] font-bold uppercase tracking-wide text-sl-accent-ink">
          Recommended
        </span>
      )}
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-sl-text-subtle">{tier}</p>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="font-sl-mono text-3xl font-bold tabular-nums text-sl-text">{price}</span>
        {period && <span className="text-sm text-sl-text-muted">{period}</span>}
      </div>
      {blurb && <p className="mt-2 text-sm leading-relaxed text-sl-text-muted">{blurb}</p>}
      <ul className="mt-5 flex-1 space-y-2.5">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-sl-text-muted">
            <Check className="mt-0.5 size-4 shrink-0 text-sl-accent" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <div className="mt-6">
        {cta.disabled || !cta.href ? (
          <Button variant="secondary" size="md" className="w-full" disabled={cta.disabled}>
            {cta.label}
          </Button>
        ) : (
          <Button asChild variant={featured ? "primary" : "secondary"} size="md" className="w-full">
            <Link href={cta.href}>{cta.label}</Link>
          </Button>
        )}
        {note && <p className="mt-3 text-center text-xs text-sl-text-subtle">{note}</p>}
      </div>
    </div>
  );
}
