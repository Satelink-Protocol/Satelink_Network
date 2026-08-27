/**
 * Guardrail thresholds from platform_flags (PR #329 pattern): flip a threshold
 * without a redeploy. Fail-CLOSED to DEFAULT_THRESHOLDS on any DB error — a flag
 * read must never make the guardrails more permissive than their defaults by
 * accident, and must never wedge the loop.
 */

import type pg from 'pg';
import { DEFAULT_THRESHOLDS, type Thresholds } from './evaluate.js';

const KEYS: Record<keyof Thresholds, string> = {
  rowsPerHour: 'guardrail_rows_per_hour',
  volumeWarnPct: 'guardrail_volume_warn_pct',
  volumeCritPct: 'guardrail_volume_crit_pct',
  expectedWriteRatio: 'guardrail_write_ratio',
  writeRatioTolerance: 'guardrail_write_ratio_tolerance',
  writeRatioMinRows: 'guardrail_write_ratio_min_rows',
  driverStaleMinutes: 'guardrail_driver_stale_minutes',
};

export async function loadThresholds(
  pool: pg.Pool,
  log: Pick<Console, 'error'> = console,
): Promise<Thresholds> {
  try {
    const keyList = Object.values(KEYS);
    const { rows } = await pool.query<{ key: string; value: string }>(
      `SELECT key, value FROM platform_flags WHERE key = ANY($1)`,
      [keyList],
    );
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    const out = { ...DEFAULT_THRESHOLDS };
    for (const field of Object.keys(KEYS) as (keyof Thresholds)[]) {
      const raw = byKey.get(KEYS[field]);
      if (raw !== undefined) {
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 0) out[field] = n;
      }
    }
    return out;
  } catch (err) {
    log.error('[guardrails] threshold read failed — using defaults (fail-closed):', err);
    return DEFAULT_THRESHOLDS;
  }
}
