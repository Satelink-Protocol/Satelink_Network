'use client';

import { useState, type ReactNode } from 'react';
import clsx from 'clsx';

import styles from './Panel.module.css';

export interface PanelProps {
  children?: ReactNode;
  /** Panel title — renders a collapsible section header. */
  title?: string;
  /** Optional right-aligned slot inside the section header. */
  headerRight?: ReactNode;
  /** If true, removes body padding. */
  flush?: boolean;
  /** Start collapsed. Only applicable when `title` is provided. */
  defaultCollapsed?: boolean;
  className?: string;
  loading?: boolean;
  emptyState?: ReactNode;
}

/**
 * Base surface — Grafana-style panel with accent top bar, dark bg, and border.
 */
export function Panel({
  children,
  title,
  headerRight,
  flush,
  defaultCollapsed = false,
  className,
  loading,
  emptyState,
}: PanelProps): JSX.Element {
  const [open, setOpen] = useState(!defaultCollapsed);

  const containerClasses = clsx(
    "relative flex flex-col bg-zinc-900/60 border border-zinc-800 rounded-sm overflow-hidden",
    className
  );
  
  const accentBar = <div className="absolute top-0 inset-x-0 h-[3px] bg-[hsl(174,80%,38%)]" />;

  const renderContent = () => {
    if (loading) {
      return (
        <div className={clsx("flex-1", !flush && "p-4 space-y-3")}>
          <div className="h-4 bg-zinc-800/50 rounded animate-pulse w-1/3" />
          <div className="h-16 bg-zinc-800/50 rounded animate-pulse" />
        </div>
      );
    }
    if (emptyState) {
      return <div className={clsx("flex-1", !flush && "p-4")}>{emptyState}</div>;
    }
    return <div className={clsx("flex-1 min-h-0", !flush && "p-4")}>{children}</div>;
  };

  if (!title) {
    return (
      <div className={containerClasses}>
        {accentBar}
        {renderContent()}
      </div>
    );
  }

  return (
    <div className={containerClasses}>
      {accentBar}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/50 bg-zinc-900/80">
        <button
          type="button"
          className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-white transition-colors"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={clsx("transition-transform duration-200", open ? "rotate-90" : "")}
          >
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
          {title}
        </button>
        <div className="flex items-center gap-2">
          {headerRight}
        </div>
      </div>
      {open ? renderContent() : null}
    </div>
  );
}
