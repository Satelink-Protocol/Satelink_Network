import * as React from "react";
import { Inbox, type LucideIcon } from "lucide-react";

import { cn } from "../lib/utils";

export interface EmptyStateProps {
  /** Visual tone — `error` switches to a destructive treatment. */
  tone?: "neutral" | "error";
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Optional call-to-action rendered under the description. */
  action?: React.ReactNode;
  className?: string;
}

/**
 * Canonical empty/error placeholder. Used directly and as the fallback for
 * both <AsyncBoundary> (no data / fetch error) and <ErrorBoundary> (runtime
 * crash) — a page never shows a blank or a stack trace.
 */
export function EmptyState({
  tone = "neutral",
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      role={tone === "error" ? "alert" : undefined}
      className={cn(
        "flex flex-col items-center justify-center gap-4 rounded-sm border border-dashed px-8 py-12 text-center",
        tone === "error" ? "border-red-500/40 bg-red-500/5" : "border-zinc-700/50 bg-zinc-900/40",
        className
      )}
    >
      <div
        className={cn(
          "flex size-12 items-center justify-center rounded-full",
          tone === "error"
            ? "bg-red-500/10 text-red-500"
            : "bg-zinc-900/60 text-zinc-600 ring-1 ring-zinc-700/50"
        )}
      >
        <Icon className="size-5" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-zinc-300">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-xs text-zinc-500">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
