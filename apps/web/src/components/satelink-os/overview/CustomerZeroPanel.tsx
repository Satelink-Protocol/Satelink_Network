import React from 'react';
import { StatusBadge } from '../badges/StatusBadge';
import { HorizontalMetricBar } from '../charts/HorizontalMetricBar';
import styles from './CustomerZeroPanel.module.css';

export interface CustomerZeroLead {
  ip: string;
  avg_daily_calls?: number;
  days_active?: number;
  status?: string;
}

export interface CustomerZeroPanelProps {
  leads: CustomerZeroLead[] | null;
  czHit: boolean;
}

const fmt = {
  num: (n: number): string =>
    n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n),
};

const stageTone = (s?: string) =>
  ({ identified: 'info', contacted: 'warn', deposited: 'primary', paid: 'success' }[s || ''] || 'muted') as any;

/**
 * Native satelink-os Customer Zero countdown panel.
 * Shows top-3 leads ranked by avg_daily_calls with inline progress bars.
 * No shadcn / external theme dependency.
 */
export function CustomerZeroPanel({ leads, czHit }: CustomerZeroPanelProps): JSX.Element {
  const sorted = [...(leads ?? [])].sort((a, b) => (b.avg_daily_calls ?? 0) - (a.avg_daily_calls ?? 0)).slice(0, 3);
  const maxCalls = Math.max(...sorted.map((l) => l.avg_daily_calls ?? 0), 1);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>Customer Zero Countdown</span>
        <StatusBadge label={czHit ? '🎯 HIT' : 'WAITING'} tone={czHit ? 'success' : 'warn'} />
      </div>

      {sorted.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>◎</span>
          <span className={styles.emptyText}>No leads classified yet</span>
          <span className={styles.emptyNote}>Run IP Classifier in Agents to populate</span>
        </div>
      ) : (
        <div className={styles.list}>
          {sorted.map((lead, i) => (
            <div key={lead.ip} className={styles.row}>
              <div className={styles.rank}>#{i + 1}</div>
              <div className={styles.info}>
                <div className={styles.ipRow}>
                  <span className={styles.ip}>{lead.ip}</span>
                  <StatusBadge label={lead.status || 'unknown'} tone={stageTone(lead.status)} />
                </div>
                <HorizontalMetricBar
                  value={lead.avg_daily_calls ?? 0}
                  max={maxCalls}
                  color="var(--sat-primary)"
                  label={`${fmt.num(lead.avg_daily_calls ?? 0)}/day`}
                />
                <div className={styles.meta}>
                  {lead.days_active != null ? `${lead.days_active}d active` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!czHit && sorted.length > 0 && (
        <div className={styles.footer}>
          <span className={styles.footerText}>
            Top candidate: <strong>{sorted[0]?.ip}</strong> · {fmt.num(sorted[0]?.avg_daily_calls ?? 0)} calls/day
          </span>
        </div>
      )}
    </div>
  );
}
