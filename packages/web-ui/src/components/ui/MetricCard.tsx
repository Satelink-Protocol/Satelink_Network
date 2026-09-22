// MetricCard — one entry from the /v1/intelligence catalog: name, kind badge,
// price, description, and a "View sample" link to the per-metric page.
// `kind` drives the badge — "model" (proxy) data gets the --sl-model badge.
import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge } from "./Badge";
import { Card, CardTitle } from "./Card";
import { cn } from "../../lib/utils";

export interface MetricCardProps {
  name: string;
  slug: string;
  kind: string;
  price: string;
  description: string;
  /** true when the metric is a modelled/proxy statistic (e.g. liquidation-clusters) */
  isModel?: boolean;
  className?: string;
}

export function MetricCard({ name, slug, kind, price, description, isModel, className }: MetricCardProps) {
  return (
    <Card interactive className={cn("flex flex-col", className)}>
      <div className="flex items-start justify-between gap-3">
        <CardTitle className="text-base">{name}</CardTitle>
        <span className="shrink-0 font-sl-mono text-sm font-semibold tabular-nums text-sl-accent">
          {price}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge variant={isModel ? "model" : "neutral"}>{kind}</Badge>
        {isModel && <Badge variant="model">model / proxy</Badge>}
      </div>
      <p className="mt-3 flex-1 text-sm leading-relaxed text-sl-text-muted">{description}</p>
      <Link
        href={`/intelligence/${slug}`}
        className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-sl-accent hover:text-sl-accent-strong"
      >
        View sample <ArrowRight className="size-3.5" />
      </Link>
    </Card>
  );
}
