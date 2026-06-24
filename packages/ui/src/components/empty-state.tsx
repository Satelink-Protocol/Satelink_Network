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
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center",
        tone === "error" ? "border-destructive/30" : "border-border",
        className
      )}
    >
      <div
        className={cn(
          "flex size-10 items-center justify-center rounded-full",
          tone === "error"
            ? "bg-destructive/10 text-destructive"
            : "bg-muted text-muted-foreground"
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
