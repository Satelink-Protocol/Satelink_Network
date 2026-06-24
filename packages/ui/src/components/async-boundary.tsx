"use client";

import * as React from "react";

import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";
import { ErrorBoundary } from "./error-boundary";
import { LoadingState, type LoadingStateProps } from "./loading-state";

export interface AsyncBoundaryProps {
  /** Fetch in flight → loading state. */
  loading?: boolean;
  /** Truthy → error state (string message or Error). */
  error?: unknown;
  /** Fetch succeeded but returned no rows → empty state. */
  isEmpty?: boolean;
  /** Success content. */
  children: React.ReactNode;

  loadingVariant?: LoadingStateProps["variant"];
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  errorTitle?: string;
  /** Show a Retry button in the error state. */
  onRetry?: () => void;
}

function errorMessage(error: unknown): string | undefined {
  if (!error) return undefined;
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return undefined;
}

/**
 * Single primitive that renders the four mandated states for any API widget:
 *   loading → <LoadingState>
 *   error   → <ErrorState> (+ optional Retry)
 *   empty   → <EmptyState>
 *   success → children, wrapped in an <ErrorBoundary> so a runtime crash in
 *             the success branch ALSO degrades to an ErrorState, never a blank
 *             or broken page.
 */
export function AsyncBoundary({
  loading,
  error,
  isEmpty,
  children,
  loadingVariant = "rows",
  emptyTitle = "No data yet",
  emptyDescription,
  emptyAction,
  errorTitle = "Couldn't load this",
  onRetry,
}: AsyncBoundaryProps) {
  if (loading) {
    return <LoadingState variant={loadingVariant} />;
  }

  if (error) {
    return (
      <ErrorState
        title={errorTitle}
        description={errorMessage(error) ?? undefined}
        onRetry={onRetry}
      />
    );
  }

  if (isEmpty) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }

  return <ErrorBoundary title={errorTitle}>{children}</ErrorBoundary>;
}
