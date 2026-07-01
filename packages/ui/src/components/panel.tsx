"use client";

import * as React from "react";
import { MoreVertical, RotateCw } from "lucide-react";

import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { EmptyState } from "./empty-state";
import { StatusPill } from "./status-pill";
import type { SystemState } from "../tokens";

export interface PanelProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Right-aligned header controls (buttons, selectors). */
  actions?: React.ReactNode;
  /** Time-range control slot, rendered next to actions. */
  timeRange?: React.ReactNode;
  /** Status pill in the header — raw API status string. */
  status?: string | null;
  /** Explicit state override for the status pill. */
  statusState?: SystemState;
  /** Context menu content; when provided a ⋮ trigger appears. */
  contextMenu?: React.ReactNode;

  /** Data lifecycle — exactly one body treatment renders. */
  loading?: boolean;
  /** True (or a node) when the data source returned nothing. */
  empty?: boolean | React.ReactNode;
  emptyTitle?: string;
  emptyHint?: string;
  /** Error message; renders the error treatment with optional retry. */
  error?: string | null;
  onRetry?: () => void;

  /** Fixed body height (px) for grid-aligned panels. */
  height?: number;
  /** Remove body padding for edge-to-edge content (tables, charts). */
  flush?: boolean;
  className?: string;
  children?: React.ReactNode;
}

/**
 * The core Grafana-style panel shell. Every dashboard tile composes this:
 * 1px border, dense header (title + status + time range + actions + menu),
 * and an honest body — loading renders a skeleton, an absent data source
 * renders <EmptyState>, an error renders a retryable error state. Fabricated
 * placeholder numbers are never an option.
 */
export function Panel({
  title,
  description,
  actions,
  timeRange,
  status,
  statusState,
  contextMenu,
  loading = false,
  empty = false,
  emptyTitle,
  emptyHint,
  error,
  onRetry,
  height,
  flush = false,
  className,
  children,
}: PanelProps) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const hasHeader =
    title || description || actions || timeRange || status || contextMenu;

  let body: React.ReactNode;
  if (loading) {
    body = (
      <div className="flex h-full min-h-24 flex-col gap-2" aria-busy="true">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="min-h-16 w-full flex-1" />
      </div>
    );
  } else if (error) {
    body = (
      <EmptyState
        tone="error"
        title="Failed to load"
        description={error}
        className="h-full border-0 py-8"
        action={
          onRetry ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RotateCw className="size-3.5" />
              Retry
            </Button>
          ) : undefined
        }
      />
    );
  } else if (empty) {
    body =
      typeof empty === "boolean" ? (
        <EmptyState
          title={emptyTitle ?? "No data yet"}
          description={emptyHint}
          className="h-full border-0 py-8"
        />
      ) : (
        empty
      );
  } else {
    body = children;
  }

  return (
    <section
      data-slot="panel"
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border border-[hsl(var(--card-border))] bg-card text-card-foreground shadow-[var(--elev-panel)] transition-tokens panel-hover",
        className
      )}
    >
      {hasHeader && (
        <header className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {title ? (
                <h3 className="truncate text-sm font-semibold text-foreground">
                  {title}
                </h3>
              ) : null}
              {status !== undefined && status !== null ? (
                <StatusPill status={status} state={statusState} />
              ) : null}
            </div>
            {description ? (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {timeRange}
            {actions}
            {contextMenu ? (
              <div className="relative">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label="Panel menu"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((o) => !o)}
                >
                  <MoreVertical className="size-3.5" />
                </Button>
                {menuOpen ? (
                  <div
                    className="absolute right-0 top-8 z-20 min-w-36 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-[var(--elev-overlay)]"
                    onClick={() => setMenuOpen(false)}
                  >
                    {contextMenu}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </header>
      )}
      <div
        className={cn("min-h-0 flex-1", flush ? "p-0" : "p-4")}
        style={height ? { height } : undefined}
      >
        {body}
      </div>
    </section>
  );
}
