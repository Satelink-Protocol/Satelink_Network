import type { ReactNode } from 'react';

import styles from './SectionLabel.module.css';

export interface SectionLabelProps {
  children: string;
  /** Optional right-aligned slot (badge, control). */
  right?: ReactNode;
}

/** Mono uppercase section heading row. */
export function SectionLabel({ children, right }: SectionLabelProps): JSX.Element {
  return (
    <div className={styles.row}>
      <div className={styles.label}>── {children.toUpperCase()}</div>
      {right ? <div>{right}</div> : null}
    </div>
  );
}
