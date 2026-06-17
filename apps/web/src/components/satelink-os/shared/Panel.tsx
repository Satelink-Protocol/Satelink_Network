import type { ReactNode } from 'react';
import clsx from 'clsx';

import styles from './Panel.module.css';

export interface PanelProps {
  children: ReactNode;
  /** Optional padding removal for flush content (e.g. tables, charts). */
  flush?: boolean;
  className?: string;
}

/** Base surface — the single bordered container primitive (SigNoz `Card`). */
export function Panel({ children, flush, className }: PanelProps): JSX.Element {
  return (
    <div className={clsx(styles.panel, flush && styles.flush, className)}>
      {children}
    </div>
  );
}
