/**
 * reconciliation_state (single-row snapshot + halt flag) and outbox writes.
 * The endpoint reads the snapshot; the outbox-publisher drains the events.
 */

import type { Queryable } from './db.js';

export interface ReconciliationSnapshot {
  readonly lastRunAt: Date;
  readonly driftMinorUnits: bigint;
  readonly halted: boolean;
  readonly haltReason: string | null;
  readonly stuckSettlementCount: number;
  readonly reconciledCount: number;
  readonly cycleDurationMs: number;
}

export async function writeReconciliationState(
  exec: Queryable,
  s: ReconciliationSnapshot,
): Promise<void> {
  await exec.query(
    `UPDATE reconciliation_state
        SET last_run_at = $1,
            drift_minor_units = $2,
            halted = $3,
            halt_reason = $4,
            stuck_settlement_count = $5,
            reconciled_count = $6,
            cycle_duration_ms = $7,
            updated_at = now()
      WHERE id = 1`,
    [
      s.lastRunAt,
      s.driftMinorUnits.toString(),
      s.halted,
      s.haltReason,
      s.stuckSettlementCount,
      s.reconciledCount,
      s.cycleDurationMs,
    ],
  );
}

export interface ReconciliationStateRow {
  readonly last_run_at: Date | null;
  readonly drift_minor_units: string;
  readonly halted: boolean;
  readonly halt_reason: string | null;
  readonly stuck_settlement_count: number;
  readonly reconciled_count: number;
  readonly cycle_duration_ms: number;
  readonly updated_at: Date;
}

export async function readReconciliationState(
  exec: Queryable,
): Promise<ReconciliationStateRow | null> {
  const res = await exec.query<ReconciliationStateRow>(
    `SELECT last_run_at, drift_minor_units, halted, halt_reason,
            stuck_settlement_count, reconciled_count, cycle_duration_ms, updated_at
       FROM reconciliation_state WHERE id = 1`,
  );
  return res.rows[0] ?? null;
}

export type EventSeverity = 'info' | 'warning' | 'critical';

/**
 * Append a domain event to the outbox. Idempotent on event_id: emitting the
 * same logical event twice is a no-op, so callers can re-emit safely.
 * Returns true when a NEW row was inserted.
 */
export async function emitEvent(
  exec: Queryable,
  event: {
    eventId: string;
    eventType: string;
    severity: EventSeverity;
    payload: unknown;
  },
): Promise<boolean> {
  const res = await exec.query(
    `INSERT INTO outbox (event_id, event_type, severity, payload)
       VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (event_id) DO NOTHING`,
    [event.eventId, event.eventType, event.severity, JSON.stringify(event.payload)],
  );
  return (res.rowCount ?? 0) > 0;
}
