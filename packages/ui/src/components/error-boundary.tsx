"use client";

import * as React from "react";

import { ErrorState } from "./error-state";

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Custom fallback. Defaults to an error <EmptyState>. */
  fallback?: React.ReactNode;
  title?: string;
  description?: string;
  /** Called once when an error is caught (telemetry hook). */
  onError?: (error: Error, info: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Catches render-time exceptions in its subtree and renders an EmptyState
 * instead of letting the error bubble up and blank the whole page.
 *
 * RULE: runtime errors must never crash pages — wrap every API-driven widget.
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Never throw from here. Surface to telemetry if a handler is provided.
    if (this.props.onError) {
      try {
        this.props.onError(error, info);
      } catch {
        /* swallow — a broken telemetry hook must not crash the page */
      }
    } else if (typeof console !== "undefined") {
      console.error("[ErrorBoundary] caught:", error);
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) return this.props.fallback;
      return (
        <ErrorState
          title={this.props.title ?? "Something went wrong"}
          description={
            this.props.description ??
            "This section failed to render. Other parts of the page are unaffected."
          }
        />
      );
    }
    return this.props.children;
  }
}
