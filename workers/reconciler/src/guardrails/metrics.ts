/**
 * Collect the guardrail metrics snapshot from Postgres. All reads; never writes.
 * revenue_events_v2.created_at is bigint SECONDS; ledger_entries.created_at is
 * timestamptz — the two are queried with their respective units.
 */

import type pg from 'pg';
import type { Metrics, StaleDriver } from './evaluate.js';

export interface MetricsInput {
  readonly volumeCapacityBytes: number;
  readonly driverStaleMinutes: number;
}

export async function collectMetrics(pool: pg.Pool, input: MetricsInput): Promise<Metrics> {
  const [rev, led, sizes, wal, drivers] = await Promise.all([
    pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM revenue_events_v2
        WHERE created_at > extract(epoch FROM now()) - 3600`,
    ),
    pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ledger_entries
        WHERE created_at > now() - interval '1 hour'`,
    ),
    pool.query<{ db: string }>(`SELECT pg_database_size(current_database())::text AS db`),
    pool.query<{ wal: string }>(`SELECT COALESCE(sum(size),0)::text AS wal FROM pg_ls_waldir()`),
    pool.query<{ driver_name: string; mins: string; done: string | null; planned: string | null }>(
      `SELECT driver_name,
              (extract(epoch FROM (now() - last_heartbeat_at)) / 60)::int::text AS mins,
              calls_done::text AS done, calls_planned::text AS planned
         FROM driver_heartbeats
        WHERE status = 'active'
          AND last_heartbeat_at < now() - ($1 || ' minutes')::interval`,
      [String(input.driverStaleMinutes)],
    ),
  ]);

  const staleDrivers: StaleDriver[] = drivers.rows.map((r) => ({
    driverName: r.driver_name,
    minutesSinceHeartbeat: Number(r.mins),
    callsDone: r.done === null ? null : Number(r.done),
    callsPlanned: r.planned === null ? null : Number(r.planned),
  }));

  return {
    revenueRowsLastHour: Number(rev.rows[0]?.n ?? '0'),
    ledgerRowsLastHour: Number(led.rows[0]?.n ?? '0'),
    dbBytes: Number(sizes.rows[0]?.db ?? '0'),
    walBytes: Number(wal.rows[0]?.wal ?? '0'),
    volumeCapacityBytes: input.volumeCapacityBytes,
    staleDrivers,
  };
}
