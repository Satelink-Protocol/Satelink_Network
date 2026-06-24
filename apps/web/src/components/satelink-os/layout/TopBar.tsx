import { StatusDot } from '../badges/StatusDot';
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

/** SigNoz-style persistent top bar: search | range | env · stats · live · refresh. */
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
      {/* Left: search */}
      <div className={styles.leftSection}>
        <div className={styles.searchWrapper} aria-hidden="true">
          <span className={styles.searchIcon}>
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </span>
          <span className={styles.searchText}>{searchPlaceholder}</span>
          <span className={styles.kbd}>⌘K</span>
        </div>
      </div>

      {/* Center: cosmetic range label */}
      <div className={styles.rangeSection}>
        <span className={styles.rangeIcon}>
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
        </span>
        <span className={styles.rangeValue}>SINCE LAUNCH</span>
        <span className={styles.rangeTag}>183d</span>
      </div>

      {/* Right: env · stats · live · refresh */}
      <div className={styles.rightSection}>
        {environment ? (
          <span className={styles.env}>
            <span className={styles.envLabel}>ENV</span>
            <span className={styles.envValue}>{environment}</span>
          </span>
        ) : null}

        {status.length > 0 ? (
          <>
            <span className={styles.divider} />
            <div className={styles.statGroup}>
              {status.map((s) => (
                <span key={s.label} className={styles.stat}>
                  <span className={styles.statLabel}>{s.label}</span>
                  <span className={styles.statValue} data-tone={s.tone ?? 'muted'}>
                    {s.value}
                  </span>
                </span>
              ))}
            </div>
          </>
        ) : null}

        <span className={styles.divider} />

        <div className={styles.liveSection}>
          <StatusDot tone={liveTone} pulse />
          {time ? <span className={styles.time}>{time}</span> : null}
        </div>

        {onRefresh ? (
          <button
            type="button"
            className={styles.refreshBtn}
            onClick={onRefresh}
            title="Refresh all data"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"></polyline>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
          </button>
        ) : null}
      </div>
    </header>
  );
}
