import * as React from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

import { cn } from "../lib/utils";

export interface MetricTrendProps {
  /** Display value, e.g. "12.5%" or "+1,204". */
  value: React.ReactNode;
  direction?: "up" | "down" | "neutral";
  /**
   * When false, an "up" trend is treated as bad (red) and "down" as good
   * (e.g. error rate, latency). Defaults to true (up = good = emerald).
   */
  positiveIsGood?: boolean;
  /** Render as a filled pill (default) or inline text. */
  variant?: "pill" | "inline";
  className?: string;
}

/**
 * Compact trend indicator (arrow + delta) used inside StatCard and tables.
 * Color encodes good/bad, not just up/down.
 */
export function MetricTrend({
  value,
  direction = "neutral",
  positiveIsGood = true,
  variant = "pill",
  className,
}: MetricTrendProps) {
  const Icon =
    direction === "up" ? TrendingUp : direction === "down" ? TrendingDown : Minus;

  const good =
    direction === "neutral"
      ? "neutral"
      : (direction === "up") === positiveIsGood
        ? "good"
        : "bad";

  const tone =
    good === "good"
      ? "text-success"
      : good === "bad"
        ? "text-destructive"
        : "text-muted-foreground";

  const pillTone =
    good === "good"
      ? "bg-success/10 text-success"
      : good === "bad"
        ? "bg-destructive/10 text-destructive"
        : "bg-muted text-muted-foreground";

  return (
    <span
      data-slot="metric-trend"
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium tabular-nums",
        variant === "pill" ? cn("rounded-md px-1.5 py-0.5", pillTone) : tone,
        className
      )}
    >
      <Icon className="size-3.5" />
      {value}
    </span>
  );
}
