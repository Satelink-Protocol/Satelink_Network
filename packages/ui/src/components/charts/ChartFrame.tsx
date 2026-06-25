"use client";
import type { ReactNode } from 'react';

import { EmptyState } from '../empty-state';
import styles from './ChartFrame.module.css';

interface SectionLabelProps {
  children: string;
  right?: ReactNode;
}

function SectionLabel({ children, right }: SectionLabelProps): JSX.Element {
  return (
    <div className="flex justify-between items-center mb-3.5">
      <div className="font-sans text-[13px] font-semibold text-muted-foreground tracking-tight">
        {children}
      </div>
      {right ? <div>{right}</div> : null}
    </div>
  );
}

export interface ChartFrameProps {
  title: string;
  hasData: boolean;
  emptyNote?: string;
  children?: ReactNode;
}

/**
 * Wraps every chart with title + the empty-state contract. With no telemetry
 * endpoint, charts render the empty state — never fabricated series (Phase 9).
 */
export function ChartFrame({ title, hasData, emptyNote, children }: ChartFrameProps): JSX.Element {
  if (!hasData)
    return (
      <EmptyState
        title={title}
        description={`Telemetry backend not yet implemented. ${emptyNote || ""}`}
      />
    );
  return (
    <div className={styles.frame}>
      <SectionLabel>{title}</SectionLabel>
      <div className={styles.body}>{children}</div>
    </div>
  );
}
