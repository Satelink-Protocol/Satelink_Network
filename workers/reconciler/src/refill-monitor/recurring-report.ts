/**
 * Recurring report — query logic for the /internal/recurring endpoint.
 *
 * Reads authorizations and outbox to produce the diagnostic
 * payload specified in the M9 milestone (nonces signed/consumed/remaining,
 * refill events, signature events after first, current authorization status).
 */

import type { Queryable } from '../db.js';

export interface RecurringAuthDetail {
  readonly id: string;
  readonly cap_amount: string;
  readonly consumed_amount: string;
  readonly remaining: string;
  readonly position: number;
}

export interface RefillEvent {
  readonly from_auth_id: string;
  readonly to_auth_id: string;
  readonly at: string;
}

export interface ScheduleReport {
  readonly schedule_id: string;
  readonly principal_id: string;
  readonly nonces: {
    readonly signed: number;
    readonly consumed: number;
    readonly remaining: number;
  };
  readonly current_authorization: RecurringAuthDetail | null;
  readonly refill_events: RefillEvent[];
  readonly signature_events_after_first: number;
  readonly total_capacity: string;
  readonly total_consumed: string;
  readonly total_remaining: string;
}

export interface RecurringReport {
  readonly ok: true;
  readonly schedules: ScheduleReport[];
}

export async function buildRecurringReport(exec: Queryable): Promise<RecurringReport> {
  // 1. Fetch all schedules with their authorization details.
  const scheduleRes = await exec.query<{
    schedule_id: string;
    principal_id: string;
    auths: string;
  }>(`
    SELECT schedule_id,
           principal_id,
           json_agg(json_build_object(
             'id', id,
             'cap_amount', cap_amount::text,
             'consumed_amount', consumed_amount::text,
             'state', state,
             'valid_before', valid_before,
             'created_at', created_at
           ) ORDER BY valid_before ASC, id ASC) AS auths
      FROM authorizations
     WHERE schedule_id IS NOT NULL
     GROUP BY schedule_id, principal_id
  `);

  const schedules: ScheduleReport[] = [];

  for (const row of scheduleRes.rows) {
    interface AuthRow {
      id: string;
      cap_amount: string;
      consumed_amount: string;
      state: string;
      valid_before: string;
      created_at: string;
    }
    const auths: AuthRow[] =
      typeof row.auths === 'string' ? JSON.parse(row.auths) : row.auths;

    // Nonce counts.
    let totalCapacity = 0n;
    let totalConsumed = 0n;
    let consumedCount = 0;
    let currentAuth: RecurringAuthDetail | null = null;

    for (let i = 0; i < auths.length; i++) {
      const a = auths[i]!;
      const cap = BigInt(a.cap_amount);
      const consumed = BigInt(a.consumed_amount);
      const remaining = cap - consumed;
      totalCapacity += cap;
      totalConsumed += consumed;

      if (remaining <= 0n || a.state !== 'active') {
        consumedCount += 1;
      } else if (currentAuth === null) {
        // First auth with remaining capacity = current.
        currentAuth = {
          id: a.id,
          cap_amount: a.cap_amount,
          consumed_amount: a.consumed_amount,
          remaining: remaining.toString(),
          position: i + 1,
        };
      }
    }

    const remainingCount = auths.length - consumedCount;

    // 2. Refill events from outbox.
    const eventsRes = await exec.query<{
      payload: { from_auth_id: string; to_auth_id: string; at: string };
    }>(
      `SELECT payload FROM outbox
        WHERE event_type = 'authorization.nonce_transition'
          AND payload->>'schedule_id' = $1
        ORDER BY created_at ASC`,
      [row.schedule_id],
    );

    const refillEvents: RefillEvent[] = eventsRes.rows.map((e) => {
      const p = typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload;
      return {
        from_auth_id: p.from_auth_id,
        to_auth_id: p.to_auth_id,
        at: p.at,
      };
    });

    // 3. Signature events after first.
    // Count authorizations whose created_at is > 1 minute after the earliest.
    let signatureEventsAfterFirst = 0;
    if (auths.length > 1) {
      const timestamps = auths.map((a) => new Date(a.created_at).getTime()).sort((x, y) => x - y);
      const firstTs = timestamps[0]!;
      signatureEventsAfterFirst = timestamps.filter((t) => t - firstTs > 60_000).length;
    }

    schedules.push({
      schedule_id: row.schedule_id,
      principal_id: row.principal_id,
      nonces: {
        signed: auths.length,
        consumed: consumedCount,
        remaining: remainingCount,
      },
      current_authorization: currentAuth,
      refill_events: refillEvents,
      signature_events_after_first: signatureEventsAfterFirst,
      total_capacity: totalCapacity.toString(),
      total_consumed: totalConsumed.toString(),
      total_remaining: (totalCapacity - totalConsumed).toString(),
    });
  }

  return { ok: true, schedules };
}
