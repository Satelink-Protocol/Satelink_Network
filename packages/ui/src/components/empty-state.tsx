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
        "flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed px-8 py-12 text-center glass-panel",
        tone === "error" ? "border-destructive/40 bg-destructive/5" : "border-border/60 bg-muted/20",
        className
      )}
    >
      <div
        className={cn(
          "flex size-12 items-center justify-center rounded-full shadow-inner",
          tone === "error"
            ? "bg-destructive/10 text-destructive ring-1 ring-destructive/20"
            : "bg-background/80 text-muted-foreground ring-1 ring-border/50"
        )}
      >
        <Icon className="size-5" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-xs text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
