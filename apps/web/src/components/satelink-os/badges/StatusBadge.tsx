import type { Tone } from '../shared/types';
import styles from './StatusBadge.module.css';

export interface StatusBadgeProps {
  label: string;
  tone?: Tone;
}

/** Centralized status pill — tone → color mapping lives here, not at call sites. */
export function StatusBadge({ label, tone = 'primary' }: StatusBadgeProps): JSX.Element {
  return (
    <span className={styles.badge} data-tone={tone}>
      {(label ?? '').toUpperCase()}
    </span>
  );
}
