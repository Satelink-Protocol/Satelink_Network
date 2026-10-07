// tracedPool (Stage 19): a pg pool wrapper that carries the current trace context into
// Postgres, so the 029 BEFORE INSERT triggers stamp trace_id / span_id / parent_span_id on
// every chain row without changing any existing store. Inject it wherever a pg pool goes
// (PgOmsStore, PgRiskStore, PgTraceStore, …).
//
// Every connection checked out through it gets the context set (or cleared) at checkout and
// cleared again on release, so a pooled connection never carries a stale trace to another
// caller, including callers using the raw pool.
import { AuditError } from './errors.mjs';
import { currentTrace } from './trace_context.mjs';

const SET = `SELECT set_config('satelink.trace_id', $1, false), set_config('satelink.span_id', $2, false)`;
const CLEAR = `SELECT set_config('satelink.trace_id', '', false), set_config('satelink.span_id', '', false)`;

export function tracedPool(pool, { context = currentTrace } = {}) {
  if (!pool || typeof pool.connect !== 'function' || typeof pool.query !== 'function') throw new AuditError('CONFIG', 'tracedPool needs a pg pool');
  const checkout = async () => {
    const client = await pool.connect();
    const ctx = context();
    try {
      await client.query(SET, [ctx?.traceId ?? '', ctx?.spanId ?? '']);
    } catch (e) {
      client.release(e);
      throw e;
    }
    const release = client.release.bind(client);
    let released = false;
    client.release = (err) => {
      if (released) return;
      released = true;
      if (err) { release(err); return; } // a broken connection is destroyed by pg anyway
      client.query(CLEAR).then(() => release(), (e) => release(e));
    };
    return client;
  };
  return {
    async connect() { return checkout(); },
    async query(text, params) {
      const client = await checkout();
      try { return await client.query(text, params); } finally { client.release(); }
    },
    end: (...a) => pool.end(...a),
    on: (...a) => pool.on(...a),
    get totalCount() { return pool.totalCount; },
    get idleCount() { return pool.idleCount; },
  };
}
