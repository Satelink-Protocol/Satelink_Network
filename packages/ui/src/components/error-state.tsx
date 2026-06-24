import * as React from "react";
import { AlertTriangle, type LucideIcon } from "lucide-react";

import { cn } from "../lib/utils";
import { Button } from "./ui/button";

export interface ErrorStateProps {
  title?: string;
  description?: string;
  icon?: LucideIcon;
  /** Show a Retry button wired to this handler. */
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

/**
 * Canonical failure placeholder for a data widget — used directly and by
 * <AsyncBoundary> for the error state. Never a stack trace, never a blank.
 */
export function ErrorState({
  title = "Couldn't load this",
  description = "An unexpected error occurred. Please retry.",
  icon: Icon = AlertTriangle,
  onRetry,
  retryLabel = "Retry",
  className,
}: ErrorStateProps) {
  return (
    <div
      data-slot="error-state"
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-destructive/30 px-6 py-10 text-center",
        className
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <Icon className="size-5" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mx-auto max-w-sm text-xs text-muted-foreground">{description}</p>
      </div>
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry} className="mt-1">
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
