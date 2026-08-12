/**
 * Postgres access for the worker.
 *
 * `Queryable` is the minimal surface both a `pg.Pool` and a `pg.PoolClient`
 * satisfy. The reconcile/poll/publish functions take a `Queryable` so they can
 * run either against the pool (the scheduler) or inside a single transaction
 * (the exit-gate drift test, which BEGIN…ROLLBACKs so nothing persists).
 */

import pg from 'pg';

export interface QueryResultRow {
  [column: string]: unknown;
}

export interface Queryable {
  // R is unconstrained so callers can pass precise named row shapes; pg.Pool
  // and pg.PoolClient both satisfy this narrower surface.
  query<R = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: 4,
    // A settlement RPC round-trip can be slow; keep idle conns short-lived.
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}
