import type { ReactNode } from 'react';

import { EmptyState } from '../shared/EmptyState';
import { SectionLabel } from '../shared/SectionLabel';
import styles from './ChartFrame.module.css';

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
        variant="block"
        label={title}
        message="Telemetry backend not yet implemented"
        note={emptyNote}
      />
    );
  return (
    <div className={styles.frame}>
      <SectionLabel>{title}</SectionLabel>
      <div className={styles.body}>{children}</div>
    </div>
  );
}
