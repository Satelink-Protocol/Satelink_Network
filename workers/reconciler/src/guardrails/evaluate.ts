/**
 * Guardrails — the control whose absence let the Aug-2026 ws_subscription storm
 * fill the volume and go unnoticed for 5 days, and let the M9 driver die at call
 * 64 unnoticed for 6 days.
 *
 * This module is PURE: it turns a metrics snapshot + thresholds into alerts, and
 * applies fire-once-per-window dedup. All I/O (DB reads, Brevo sends) lives
 * elsewhere so the alarm logic is unit-testable with no DB and no Docker.
 */

export type GuardrailCondition =
  | 'row_growth' // revenue_events_v2 or ledger_entries growing too fast
  | 'volume_70' // volume ≥ 70% full
  | 'volume_85' // volume ≥ 85% full
  | 'write_amplification' // ledger:revenue ratio drifted from 2:1 (new writer?)
  | 'driver_liveness'; // a registered driver's heartbeat went stale while active

export type Severity = 'warning' | 'critical';

export interface Alert {
  readonly condition: GuardrailCondition;
  /** Stable de-dup key: one email per key per window. Includes the subject when
   *  a condition can fire for multiple distinct subjects (e.g. per driver). */
  readonly key: string;
  readonly severity: Severity;
  readonly title: string;
  readonly detail: string;
}

/** A point-in-time snapshot collected from the database (see metrics.ts). */
export interface Metrics {
  readonly revenueRowsLastHour: number;
  readonly ledgerRowsLastHour: number;
  readonly dbBytes: number;
  readonly walBytes: number;
  readonly volumeCapacityBytes: number;
  readonly staleDrivers: readonly StaleDriver[];
}

export interface StaleDriver {
  readonly driverName: string;
  readonly minutesSinceHeartbeat: number;
  readonly callsDone: number | null;
  readonly callsPlanned: number | null;
}

export interface Thresholds {
  /** Alarm if revenue_events_v2 OR ledger_entries grew more than this in the last
   *  hour. Default 5,000 — the Aug-22 peak was 111,581 ledger rows in ONE hour. */
  readonly rowsPerHour: number;
  readonly volumeWarnPct: number; // default 70
  readonly volumeCritPct: number; // default 85
  /** Expected ledger:revenue write ratio (double-entry = 2:1). */
  readonly expectedWriteRatio: number; // default 2
  /** Allowed absolute deviation of the ratio before alarming. Default 0.5. */
  readonly writeRatioTolerance: number;
  /** Minimum revenue rows in the window before the ratio is meaningful. */
  readonly writeRatioMinRows: number; // default 20
  readonly driverStaleMinutes: number; // default 15
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  rowsPerHour: 5_000,
  volumeWarnPct: 70,
  volumeCritPct: 85,
  expectedWriteRatio: 2,
  writeRatioTolerance: 0.5,
  writeRatioMinRows: 20,
  driverStaleMinutes: 15,
};

/** Pure: metrics + thresholds → alerts (most severe conditions first). */
export function evaluateGuardrails(m: Metrics, t: Thresholds): Alert[] {
  const alerts: Alert[] = [];

  // 1. Row growth (hourly, not daily — a daily check catches the storm 12h late).
  const maxRows = Math.max(m.revenueRowsLastHour, m.ledgerRowsLastHour);
  if (maxRows > t.rowsPerHour) {
    alerts.push({
      condition: 'row_growth',
      key: 'row_growth',
      severity: 'critical',
      title: `Money-path row growth ${maxRows}/h exceeds ${t.rowsPerHour}/h`,
      detail: `revenue_events_v2 +${m.revenueRowsLastHour}/h, ledger_entries +${m.ledgerRowsLastHour}/h in the last 60 min. The Aug-22 storm peaked at 111,581 ledger rows/hour.`,
    });
  }

  // 2. Volume utilisation (do not wait for Railway's 99% alert).
  const usedBytes = m.dbBytes + m.walBytes;
  const pct = m.volumeCapacityBytes > 0 ? (usedBytes / m.volumeCapacityBytes) * 100 : 0;
  if (pct >= t.volumeCritPct) {
    alerts.push({
      condition: 'volume_85',
      key: 'volume_85',
      severity: 'critical',
      title: `Volume ${pct.toFixed(1)}% full (≥ ${t.volumeCritPct}%)`,
      detail: `db ${fmtGB(m.dbBytes)} + wal ${fmtGB(m.walBytes)} of ${fmtGB(m.volumeCapacityBytes)}. Postgres will reject writes near 100% (the Aug-22 cliff).`,
    });
  } else if (pct >= t.volumeWarnPct) {
    alerts.push({
      condition: 'volume_70',
      key: 'volume_70',
      severity: 'warning',
      title: `Volume ${pct.toFixed(1)}% full (≥ ${t.volumeWarnPct}%)`,
      detail: `db ${fmtGB(m.dbBytes)} + wal ${fmtGB(m.walBytes)} of ${fmtGB(m.volumeCapacityBytes)}.`,
    });
  }

  // 3. Write-amplification: a ratio shift means a NEW writer appeared.
  if (m.revenueRowsLastHour >= t.writeRatioMinRows) {
    const ratio = m.ledgerRowsLastHour / m.revenueRowsLastHour;
    if (Math.abs(ratio - t.expectedWriteRatio) > t.writeRatioTolerance) {
      alerts.push({
        condition: 'write_amplification',
        key: 'write_amplification',
        severity: 'warning',
        title: `Write ratio ${ratio.toFixed(2)}:1 (expected ${t.expectedWriteRatio}:1)`,
        detail: `ledger_entries:revenue_events_v2 = ${m.ledgerRowsLastHour}:${m.revenueRowsLastHour} in the last hour. A deviation from double-entry 2:1 means a new/changed writer.`,
      });
    }
  }

  // 4. Driver liveness — one alert per stale driver (the M9 control).
  for (const d of m.staleDrivers) {
    alerts.push({
      condition: 'driver_liveness',
      key: `driver_liveness:${d.driverName}`,
      severity: 'critical',
      title: `Driver "${d.driverName}" heartbeat stale ${d.minutesSinceHeartbeat}m while active`,
      detail: `No heartbeat for ${d.minutesSinceHeartbeat} min (threshold ${t.driverStaleMinutes}m). Progress ${d.callsDone ?? '?'}/${d.callsPlanned ?? '?'}. M9 died at call 64/5000 and went unnoticed for 6 days because this alarm did not exist.`,
    });
  }

  return alerts;
}

/**
 * Fire-once-per-window: given the last-sent time per key, return only the alerts
 * whose window has elapsed, plus the updated last-sent map. Pure — the caller
 * persists the state. One email per condition (per subject) per window.
 */
export function filterFireOnce(
  alerts: readonly Alert[],
  lastSentMsByKey: Readonly<Record<string, number>>,
  nowMs: number,
  windowMs: number,
): { toSend: Alert[]; nextState: Record<string, number> } {
  const nextState: Record<string, number> = { ...lastSentMsByKey };
  const toSend: Alert[] = [];
  for (const a of alerts) {
    const last = lastSentMsByKey[a.key];
    if (last === undefined || nowMs - last >= windowMs) {
      toSend.push(a);
      nextState[a.key] = nowMs;
    }
  }
  return { toSend, nextState };
}

function fmtGB(bytes: number): string {
  return `${(bytes / 1_073_741_824).toFixed(2)}GB`;
}
