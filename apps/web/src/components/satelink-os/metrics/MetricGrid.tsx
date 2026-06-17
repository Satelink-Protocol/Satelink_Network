import type { ReactNode } from 'react';

import styles from './MetricGrid.module.css';

export interface MetricGridProps {
  children: ReactNode;
  /** Columns: 2 | 3 | 4 | 6 (default 4). */
  columns?: 2 | 3 | 4 | 6;
}

/** Responsive grid for MetricCards. */
export function MetricGrid({ children, columns = 4 }: MetricGridProps): JSX.Element {
  return (
    <div className={styles.grid} data-cols={columns}>
      {children}
    </div>
  );
}
