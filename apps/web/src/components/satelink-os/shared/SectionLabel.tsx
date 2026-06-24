import type { ReactNode } from 'react';

import styles from './SectionLabel.module.css';

export interface SectionLabelProps {
  children: string;
  /** Optional right-aligned slot (badge, control). */
  right?: ReactNode;
}

/** Redesigned to match SigNoz panel titles (Screenshot 2). */
export function SectionLabel({ children, right }: SectionLabelProps): JSX.Element {
  return (
    <div className={styles.row}>
      <div className={styles.label}>{children}</div>
      {right ? <div>{right}</div> : null}
    </div>
  );
}
