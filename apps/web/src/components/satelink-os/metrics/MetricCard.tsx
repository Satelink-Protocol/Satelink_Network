import type { ReactNode } from 'react';
import clsx from 'clsx';

import type { Tone } from '../shared/types';
import styles from './MetricCard.module.css';

export interface MetricCardProps {
  label: string;
  value: ReactNode;
  sub?: string;
  tone?: Tone;
  /** Red top border + warning glyph for attention states. */
  alert?: boolean;
  /** `lg` = headline metric (28px), `sm` = compact (15px). */
  size?: 'lg' | 'sm';
  /** Small tone-colored square glyph badge, top-left. */
  icon?: ReactNode;
}

/** SigNoz-style metric widget: label top, value center-left, sub footer. */
export function MetricCard({
  label,
  value,
  sub,
  tone = 'primary',
  alert,
  size = 'lg',
}: MetricCardProps): JSX.Element {
  return (
    <div className={clsx(styles.card, alert && styles.alert)} data-tone={tone}>
      <div className={styles.head}>
        <div className={styles.label}>{label}</div>
        <span className={styles.infoIcon} title={sub || label}>
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
        </span>
      </div>
      <div className={styles.content}>
        <div className={styles.value} data-size={size}>
          {value}
        </div>
        {sub ? <div className={styles.sub}>{sub}</div> : null}
      </div>
    </div>
  );
}
