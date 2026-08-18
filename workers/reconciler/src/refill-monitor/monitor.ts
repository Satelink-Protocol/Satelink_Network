/**
 * Refill monitor — detects nonce-schedule transitions and emits domain events.
 *
 * Each reconciler cycle, for every schedule_id in `authorizations`, the monitor:
 *   1. Queries the ordered set of authorizations in the schedule (id ASC).
 *   2. Determines the "current" authorization (first with remaining capacity > 0).
 *   3. Compares to `schedule_state.current_auth_id` — if different, a transition
 *      occurred. Emits an `authorization.nonce_transition` outbox event.
 *   4. Emits `authorization.schedule_low` if ≤ 1 nonce remaining.
 *   5. Emits `authorization.schedule_exhausted` if all nonces consumed.
 *
 * The monitor is OBSERVATIONAL — it never mutates authorizations or consumed_amount.
 * Selection for the request path is handled by enforceNew()'s SQL, not by this code.
 */

import type { Queryable } from '../db.js';
import { emitEvent, type EventSeverity } from '../state.js';

export interface ScheduleAuth {
  readonly id: string;
  readonly cap_amount: string;
  readonly consumed_amount: string;
  readonly state: string;
  readonly valid_before: string;
}

export interface ScheduleRow {
  readonly schedule_id: string;
  readonly principal_id: string;
  readonly auths: ScheduleAuth[];
}

export interface MonitorResult {
  readonly schedulesChecked: number;
  readonly transitionsDetected: number;
  readonly eventsEmitted: number;
}

/**
 * Find the "current" authorization — first (by position in the id-ASC-ordered
 * array) that is active AND has remaining capacity > 0.
 */
function findCurrentAuth(auths: ScheduleAuth[]): ScheduleAuth | null {
  for (const a of auths) {
    if (a.state === 'active' && BigInt(a.cap_amount) - BigInt(a.consumed_amount) > 0n) {
      return a;
    }
  }
  return null;
}

function countRemaining(auths: ScheduleAuth[]): number {
  return auths.filter(
    (a) => a.state === 'active' && BigInt(a.cap_amount) - BigInt(a.consumed_amount) > 0n,
  ).length;
}

export async function monitorSchedules(
  exec: Queryable,
  now: Date,
): Promise<MonitorResult> {
  // 1. Fetch all schedules with their authorizations (ordered by id ASC).
  const scheduleRes = await exec.query<{
    schedule_id: string;
    principal_id: string;
    auths: string; // json_agg returns text in pg driver
  }>(`
    SELECT schedule_id,
           principal_id,
           json_agg(json_build_object(
             'id', id,
             'cap_amount', cap_amount::text,
             'consumed_amount', consumed_amount::text,
             'state', state,
             'valid_before', valid_before
           ) ORDER BY valid_before ASC, id ASC) AS auths
      FROM authorizations
     WHERE schedule_id IS NOT NULL
     GROUP BY schedule_id, principal_id
  `);

  let transitionsDetected = 0;
  let eventsEmitted = 0;

  for (const row of scheduleRes.rows) {
    const auths: ScheduleAuth[] =
      typeof row.auths === 'string' ? JSON.parse(row.auths) : row.auths;
    const currentAuth = findCurrentAuth(auths);
    const remaining = countRemaining(auths);

    // 2. Read the last known current_auth_id from schedule_state.
    const stateRes = await exec.query<{ current_auth_id: string }>(
      `SELECT current_auth_id FROM schedule_state WHERE schedule_id = $1`,
      [row.schedule_id],
    );
    const previousAuthId = stateRes.rows[0]?.current_auth_id ?? null;

    // 3. Detect transition.
    if (currentAuth && previousAuthId && currentAuth.id !== previousAuthId) {
      transitionsDetected += 1;
      const emitted = await emitEvent(exec, {
        eventId: `nonce_transition:${row.schedule_id}:${currentAuth.id}`,
        eventType: 'authorization.nonce_transition',
        severity: 'info' as EventSeverity,
        payload: {
          schedule_id: row.schedule_id,
          principal_id: row.principal_id,
          from_auth_id: previousAuthId,
          to_auth_id: currentAuth.id,
          nonces_remaining: remaining,
          at: now.toISOString(),
        },
      });
      if (emitted) eventsEmitted += 1;
    }

    // 4. Update schedule_state to reflect the current auth.
    if (currentAuth) {
      await exec.query(
        `INSERT INTO schedule_state (schedule_id, principal_id, current_auth_id, updated_at)
              VALUES ($1, $2, $3, $4)
         ON CONFLICT (schedule_id) DO UPDATE
              SET current_auth_id = $3, updated_at = $4`,
        [row.schedule_id, row.principal_id, currentAuth.id, now],
      );
    }

    // 5. Low-nonce warning (≤ 1 remaining).
    if (remaining <= 1 && remaining > 0) {
      const emitted = await emitEvent(exec, {
        eventId: `schedule_low:${row.schedule_id}:remaining_${remaining}`,
        eventType: 'authorization.schedule_low',
        severity: 'warning' as EventSeverity,
        payload: {
          schedule_id: row.schedule_id,
          principal_id: row.principal_id,
          remaining_nonces: remaining,
          at: now.toISOString(),
        },
      });
      if (emitted) eventsEmitted += 1;
    }

    // 6. Schedule exhausted (0 remaining).
    if (remaining === 0) {
      const emitted = await emitEvent(exec, {
        eventId: `schedule_exhausted:${row.schedule_id}`,
        eventType: 'authorization.schedule_exhausted',
        severity: 'critical' as EventSeverity,
        payload: {
          schedule_id: row.schedule_id,
          principal_id: row.principal_id,
          at: now.toISOString(),
        },
      });
      if (emitted) eventsEmitted += 1;
    }
  }

  return {
    schedulesChecked: scheduleRes.rows.length,
    transitionsDetected,
    eventsEmitted,
  };
}
