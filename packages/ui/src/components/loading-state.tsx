import * as React from "react";

import { cn } from "../lib/utils";
import { Skeleton } from "./ui/skeleton";

export interface LoadingStateProps {
  /** Layout of the skeleton — match the success content it stands in for. */
  variant?: "rows" | "cards" | "block";
  /** Number of skeleton rows/cards. */
  count?: number;
  className?: string;
}

/**
 * Canonical loading placeholder. Skeleton-based so layout doesn't jump when
 * data arrives. Used directly and by <AsyncBoundary> for the loading state.
 */
export function LoadingState({
  variant = "rows",
  count = 4,
  className,
}: LoadingStateProps) {
  if (variant === "cards") {
    return (
      <div
        data-slot="loading-state"
        className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-4", className)}
      >
        {Array.from({ length: count }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (variant === "block") {
    return (
      <Skeleton
        data-slot="loading-state"
        className={cn("h-48 w-full rounded-xl", className)}
      />
    );
  }

  return (
    <div data-slot="loading-state" className={cn("space-y-2.5", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}
