import * as React from "react";

import { Badge } from "./ui/badge";
import { cn } from "../lib/utils";

type Variant = "success" | "warning" | "destructive" | "neutral" | "default";

const STATUS_MAP: Record<string, Variant> = {
  active: "success",
  online: "success",
  confirmed: "success",
  ok: "success",
  healthy: "success",
  pending: "warning",
  degraded: "warning",
  warning: "warning",
  failed: "destructive",
  error: "destructive",
  offline: "destructive",
  bad: "destructive",
  inactive: "neutral",
};

export interface StatusBadgeProps {
  status: string;
  /** Override the auto-mapped variant. */
  variant?: Variant;
  label?: string;
  className?: string;
}

/**
 * Status pill with a consistent status→tone mapping. Replaces the legacy
 * `os-pill ok/bad/pending` classes so every status reads identically.
 */
export function StatusBadge({
  status,
  variant,
  label,
  className,
}: StatusBadgeProps) {
  const tone = variant ?? STATUS_MAP[status?.toLowerCase()] ?? "neutral";
  return (
    <Badge variant={tone} className={cn("gap-1.5", className)}>
      {(tone === "success" || tone === "warning" || tone === "destructive") && (
        <span
          className={cn(
            "size-1.5 rounded-full shrink-0",
            tone === "success" && "bg-success animate-pulse",
            tone === "warning" && "bg-warning",
            tone === "destructive" && "bg-destructive"
          )}
        />
      )}
      {label ?? status}
    </Badge>
  );
}
