import * as React from "react";

import { Badge } from "./ui/badge";
import { cn } from "../lib/utils";
import { normalizeState, type SystemState } from "../tokens";

type Variant = "success" | "warning" | "destructive" | "neutral" | "default";

const STATE_TO_VARIANT: Record<SystemState, Variant> = {
  healthy: "success",
  degraded: "warning",
  critical: "destructive",
  unknown: "neutral",
  "dry-run": "warning",
};

export interface StatusBadgeProps {
  status: string;
  /** Override the auto-mapped variant. */
  variant?: Variant;
  label?: string;
  className?: string;
}

/**
 * Legacy status pill kept for existing call sites. Color resolution is
 * delegated to tokens/normalizeState so it can never disagree with
 * StatusPill/HealthBadge. Prefer StatusPill in new code.
 */
export function StatusBadge({
  status,
  variant,
  label,
  className,
}: StatusBadgeProps) {
  const tone = variant ?? STATE_TO_VARIANT[normalizeState(status)];
  return (
    <Badge variant={tone} className={cn("gap-1.5 transition-tokens", className)}>
      {(tone === "success" || tone === "warning" || tone === "destructive") && (
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            tone === "success" && "bg-success",
            tone === "warning" && "bg-warning",
            tone === "destructive" && "bg-destructive"
          )}
        />
      )}
      {label ?? status}
    </Badge>
  );
}
