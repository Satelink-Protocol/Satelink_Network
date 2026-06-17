import clsx from 'clsx';

import styles from './EmptyState.module.css';

export interface EmptyStateProps {
  label: string;
  /** Short note, e.g. the missing backend. */
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
  note,
  variant = 'block',
}: EmptyStateProps): JSX.Element {
  if (variant === 'line') {
    return (
      <div className={styles.line}>
        <span>── {label.toUpperCase()}</span>
        {note ? <span className={styles.lineNote}>· {note}</span> : null}
      </div>
    );
  }
  return (
    <div className={clsx(styles.block)}>
      <div className={styles.blockLabel}>{label.toUpperCase()}</div>
      <div className={styles.blockTitle}>Telemetry backend not yet implemented</div>
      {note ? <div className={styles.blockNote}>{note}</div> : null}
    </div>
  );
}
