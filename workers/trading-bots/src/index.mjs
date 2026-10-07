// Satelink Trading AI — automation bot runner worker (Phase 6 item 10).
//
// A SEPARATE process, following workers/reconciler: it owns all trading timers so the API process
// stays timer-free. Composition is deliberately minimal and fail-closed:
//   no DATABASE_URL           → no deps: every bot reports not_configured / skipped_flag
//   DATABASE_URL              → kill-switch visibility (Pg) only; venue adapters (dispatcher, fills,
//                               reconcilers) and model providers are injected by the execution
//                               service once it exists (B-08) — until then those bots stay
//                               not_configured. No live trading flag can be enabled (LOCKED).
// Endpoints: GET /health (status JSON), GET /metrics (Prometheus). SIGTERM/SIGINT stop cleanly.
import http from 'node:http';
import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { BotRunner } from '../../../apps/api/src/trading_agent/bots/index.mjs';
import { PgRiskStore } from '../../../apps/api/src/trading_agent/risk/store.mjs';

export function buildDeps({ env = process.env } = {}) {
  if (!env.DATABASE_URL) return { deps: {}, pool: null };
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 3 });
  const risk = new PgRiskStore(pool);
  let seq = 0;
  return {
    pool,
    deps: { killSwitchEvents: async () => (await risk.killSwitchEvents({ principalId: null })).map((e) => ({ seq: e.seq ?? ++seq, ...e })) },
  };
}

export function startWorker({ env = process.env, port = Number(env.PORT ?? 8081), log = console, deps: injected } = {}) {
  const built = injected ? { deps: injected, pool: null } : buildDeps({ env });
  const runner = new BotRunner({ deps: built.deps, env, log });
  const server = http.createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'trading-bots', bots: runner.status() }));
    } else if (req.url === '/metrics') {
      res.writeHead(200, { 'content-type': runner.metrics.registry.contentType });
      res.end(await runner.metrics.registry.metrics());
    } else { res.writeHead(404); res.end(); }
  });
  server.listen(port);
  runner.start();
  log.info?.(`[trading-bots] listening on :${port}; ${Object.keys(runner.status()).length} bots registered`);
  const stop = async () => { runner.stop(); await new Promise((r) => server.close(r)); await built.pool?.end(); };
  return { runner, server, stop };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const w = startWorker();
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { w.stop().finally(() => process.exit(0)); });
}
