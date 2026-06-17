import styles from './Spinner.module.css';

export interface SpinnerProps {
  label?: string;
}

/** Minimal loading indicator (SigNoz `Spinner` analogue). */
export function Spinner({ label = 'Loading…' }: SpinnerProps): JSX.Element {
  return (
    <div className={styles.wrap} role="status" aria-live="polite">
      <span className={styles.dot} />
      <span className={styles.text}>{label}</span>
    </div>
  );
}
