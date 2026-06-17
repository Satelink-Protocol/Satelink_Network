import type { Tone } from '../shared/types';
import styles from './StatusDot.module.css';

export interface StatusDotProps {
  tone?: Tone;
  pulse?: boolean;
}

/** Small status indicator dot, optionally pulsing (live signals). */
export function StatusDot({ tone = 'success', pulse }: StatusDotProps): JSX.Element {
  return <span className={styles.dot} data-tone={tone} data-pulse={pulse ? '1' : undefined} />;
}
