/**
 * M7 worker entrypoint — one process running the settlement-poller, reconciler,
 * and outbox-publisher on an internal schedule, plus the HTTP endpoint.
 *
 * Rollback: stop this process. Halting is fail-open at this stage — the halt
 * flag and critical event are recorded but nothing is enforced yet.
 */

import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { JsonRpcChainReader, rpcMapFrom } from './adapters/json-rpc-reader.js';
import { startHttpServer } from './http-server.js';
import { startScheduler } from './scheduler.js';
import { webhookDeliver } from './outbox-publisher/publish.js';

function main(): void {
  const cfg = loadConfig();
  const pool = createPool(cfg.databaseUrl);
  const chain = new JsonRpcChainReader(rpcMapFrom(cfg));
  const deliver = webhookDeliver(cfg.outboxWebhookUrl);

  const server = startHttpServer({ db: pool, internalToken: cfg.internalToken, port: cfg.port });
  const scheduler = startScheduler(pool, chain, cfg, deliver);

  console.info(
    `[reconciler] up — port=${cfg.port} interval=${cfg.reconcileIntervalMs}ms ` +
      `minConf=${cfg.minConfirmations} base=${cfg.baseRpcUrl}`,
  );

  const shutdown = (signal: string): void => {
    console.info(`[reconciler] ${signal} — shutting down`);
    scheduler.stop();
    server.close();
    void pool.end().finally(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
