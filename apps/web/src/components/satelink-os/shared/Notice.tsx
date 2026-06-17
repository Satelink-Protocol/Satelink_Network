import type { ReactNode } from 'react';

import styles from './Notice.module.css';

export interface NoticeProps {
  children: ReactNode;
  tone?: 'primary' | 'danger';
}

/** Transient banner for action confirmations / errors. */
export function Notice({ children, tone = 'primary' }: NoticeProps): JSX.Element {
  return (
    <div className={styles.notice} data-tone={tone}>
      {children}
    </div>
  );
}
