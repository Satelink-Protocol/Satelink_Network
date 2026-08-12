/**
 * Minimal HTTP surface for the worker:
 *   GET /health                  → 200 (Railway healthcheck, unauthenticated)
 *   GET /internal/reconciliation → the reconciliation snapshot (token-gated)
 *
 * The snapshot is read live from reconciliation_state so the endpoint always
 * reflects the last cycle the scheduler wrote.
 */

import { createServer, type Server } from 'node:http';
import type { Queryable } from './db.js';
import { readReconciliationState } from './state.js';

export interface HttpDeps {
  readonly db: Queryable;
  readonly internalToken: string;
  readonly port: number;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function reconciliationBody(db: Queryable): Promise<Record<string, unknown>> {
  const row = await readReconciliationState(db);
  if (row === null) {
    return { ok: false, error: 'no_reconciliation_state' };
  }
  return {
    ok: true,
    last_run_at: row.last_run_at,
    drift_minor_units: row.drift_minor_units,
    halted: row.halted,
    halt_reason: row.halt_reason,
    stuck_settlement_count: row.stuck_settlement_count,
    reconciled_count: row.reconciled_count,
    cycle_duration_ms: row.cycle_duration_ms,
    updated_at: row.updated_at,
  };
}

export function startHttpServer(deps: HttpDeps): Server {
  const server = createServer((req, res) => {
    void (async () => {
      const url = req.url ?? '/';
      const path = url.split('?')[0];
      if (req.method === 'GET' && (path === '/health' || path === '/')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }
      if (req.method === 'GET' && path === '/internal/reconciliation') {
        const provided = req.headers['x-internal-token'];
        const token = Array.isArray(provided) ? (provided[0] ?? '') : (provided ?? '');
        if (deps.internalToken === '' || !timingSafeEqual(token, deps.internalToken)) {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
          return;
        }
        try {
          const body = await reconciliationBody(deps.db);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(body));
        } catch (err) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'internal_error', message: String(err) }));
        }
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'not_found' }));
    })();
  });
  server.listen(deps.port);
  return server;
}
