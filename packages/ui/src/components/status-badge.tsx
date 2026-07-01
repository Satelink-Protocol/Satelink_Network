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
  
  const toneClasses = {
    success: "bg-green-500/10 text-green-400 border border-green-500/20",
    warning: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
    destructive: "bg-red-500/10 text-red-400 border border-red-500/20",
    neutral: "bg-zinc-500/10 text-zinc-400 border border-zinc-500/20",
    default: "bg-zinc-500/10 text-zinc-400 border border-zinc-500/20",
  }[tone];

  const dotClasses = {
    success: "bg-green-500",
    warning: "bg-amber-500",
    destructive: "bg-red-500",
    neutral: "bg-zinc-500",
    default: "bg-zinc-500",
  }[tone];

  return (
    <div className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium", toneClasses, className)}>
      <span className={cn("size-1.5 rounded-full shrink-0", dotClasses)} />
      {label ?? status}
    </div>
  );
}
