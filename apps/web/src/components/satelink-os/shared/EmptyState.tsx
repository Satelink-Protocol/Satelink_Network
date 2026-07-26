import clsx from 'clsx';

import styles from './EmptyState.module.css';

export interface EmptyStateProps {
  label: string;
  /** Main message. Default "No data yet"; pass "Telemetry backend not yet
   * implemented" for genuinely-missing backends. */
  message?: string;
  /** Short note, e.g. what the surface needs. */
  note?: string;
  /**
   * `block` = professional empty panel (default; Phase 7 honest-data state).
   * `line`  = single dim footer indicator for secondary/missing surfaces.
   */
  variant?: 'block' | 'line';
}

/**
 * Honest empty state. Used wherever a backend does not exist yet — never paired
 * with simulated data. Mirrors SigNoz's intentional `Empty` usage.
 */
export function EmptyState({
  label,
  message = 'No data yet',
  note,
  variant = 'block',
}: EmptyStateProps): JSX.Element {
  if (variant === 'line') {
    return (
      <div className={styles.line}>
        <span>── {(label ?? '').toUpperCase()}</span>
        {note ? <span className={styles.lineNote}>· {note}</span> : null}
      </div>
    );
  }
  return (
    <div className={clsx(styles.block)}>
      <div className={styles.blockLabel}>{(label ?? '').toUpperCase()}</div>
      <div className={styles.blockTitle}>{message}</div>
      {note ? <div className={styles.blockNote}>{note}</div> : null}
    </div>
  );
}
