import type { ReactNode } from 'react';
import clsx from 'clsx';

import type { Tone } from '../shared/types';
import styles from './MetricCard.module.css';

export interface MetricCardProps {
  label: string;
  value: ReactNode;
  sub?: string;
  tone?: Tone;
  /** Red border + warning glyph for attention states. */
  alert?: boolean;
  /** `lg` = headline metric (28px), `sm` = compact (15px, e.g. addresses). */
  size?: 'lg' | 'sm';
}

/** Single KPI tile, capped height, value + sublabel only. */
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
      {alert ? <span className={styles.warnGlyph}>⚠</span> : null}
      <div className={styles.label}>{label}</div>
      <div className={styles.value} data-size={size}>
        {value}
      </div>
      {sub ? <div className={styles.sub}>{sub}</div> : null}
    </div>
  );
}
