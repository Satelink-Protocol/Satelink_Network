import { StatusDot } from '../badges/StatusDot';
import { Button } from '../forms/Button';
import type { Tone } from '../shared/types';
import styles from './TopBar.module.css';

export interface TopBarStat {
  label: string;
  value: string;
  tone?: Tone;
}

export interface TopBarProps {
  brand: string;
  searchPlaceholder?: string;
  environment?: string;
  status?: TopBarStat[];
  live?: boolean;
  liveTone?: Tone;
  time?: string;
  onRefresh?: () => void;
}

/** Persistent top status bar: brand · global search · env · status · live · refresh. */
export function TopBar({
  brand,
  searchPlaceholder = 'Search…',
  environment,
  status = [],
  liveTone = 'success',
  time,
  onRefresh,
}: TopBarProps): JSX.Element {
  return (
    <header className={styles.bar}>
      <span className={styles.brand}>{brand}</span>
      <div className={styles.search} aria-hidden="true">
        <span className={styles.searchIcon}>⌕</span>
        <span className={styles.searchText}>{searchPlaceholder}</span>
        <span className={styles.kbd}>⌘K</span>
      </div>
      <div className={styles.spacer} />
      {environment ? (
        <span className={styles.env}>
          <span className={styles.envLabel}>ENV</span>
          <span className={styles.envValue}>{environment}</span>
        </span>
      ) : null}
      {status.map((s) => (
        <span key={s.label} className={styles.stat}>
          <span className={styles.statLabel}>{s.label}</span>
          <span className={styles.statValue} data-tone={s.tone ?? 'muted'}>
            {s.value}
          </span>
        </span>
      ))}
      <span className={styles.divider} />
      <span className={styles.live}>
        <StatusDot tone={liveTone} pulse />
        {time ? <span className={styles.time}>{time}</span> : null}
      </span>
      {onRefresh ? (
        <Button size="sm" tone="muted" onClick={onRefresh}>
          Refresh
        </Button>
      ) : null}
    </header>
  );
}
