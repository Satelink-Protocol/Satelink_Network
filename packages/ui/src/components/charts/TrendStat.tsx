"use client";
import styles from './TrendStat.module.css';

export interface TrendStatProps {
  label: string;
  value: string;
  delta?: string;
  direction?: 'up' | 'down' | 'flat';
}

/** Numeric value with a directional delta. */
export function TrendStat({ label, value, delta, direction = 'flat' }: TrendStatProps): JSX.Element {
  const glyph = direction === 'up' ? '▲' : direction === 'down' ? '▼' : '■';
  return (
    <div className={styles.card}>
      <div className={styles.label}>{label}</div>
      <div className={styles.row}>
        <span className={styles.value}>{value}</span>
        {delta ? (
          <span className={styles.delta} data-dir={direction}>
            {glyph} {delta}
          </span>
        ) : null}
      </div>
    </div>
  );
}
