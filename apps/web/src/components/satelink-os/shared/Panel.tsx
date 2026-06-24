'use client';

import { useState, type ReactNode } from 'react';
import clsx from 'clsx';

import styles from './Panel.module.css';

export interface PanelProps {
  children: ReactNode;
  /** Panel title — renders a SigNoz-style collapsible section header. */
  title?: string;
  /** Optional right-aligned slot inside the section header. */
  headerRight?: ReactNode;
  /** If true, removes body padding (for tables / charts that need edge-to-edge). */
  flush?: boolean;
  /** Start collapsed. Only applicable when `title` is provided. */
  defaultCollapsed?: boolean;
  className?: string;
}

/**
 * Base surface — SigNoz-style panel with collapsible header, dots menu, and flush mode.
 * Replaces the old Panel + SectionLabel combo.
 */
export function Panel({
  children,
  title,
  headerRight,
  flush,
  defaultCollapsed = false,
  className,
}: PanelProps): JSX.Element {
  const [open, setOpen] = useState(!defaultCollapsed);

  if (!title) {
    // Bare surface — no header, just a styled container.
    return (
      <div className={clsx(styles.panel, flush && styles.flush, className)}>
        <div className={styles.body}>{children}</div>
      </div>
    );
  }

  return (
    <div className={clsx(styles.panel, flush && styles.flush, className)}>
      <div className={styles.panelHeader}>
        <button
          type="button"
          className={styles.panelTitle}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={clsx(styles.chevron, open ? styles.open : styles.closed)}
          >
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
          {title}
        </button>
        <div className={styles.panelRight}>
          {headerRight}
          <button type="button" className={styles.panelDotsBtn} title="Panel options">
            •••
          </button>
        </div>
      </div>
      {open ? (
        <div className={styles.body}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
