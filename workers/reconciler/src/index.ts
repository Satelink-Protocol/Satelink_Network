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
import { runGuardrails } from './guardrails/run.js';
import { brevoSender } from './guardrails/notify.js';

const GB = 1_073_741_824;

function main(): void {
  const cfg = loadConfig();
  const pool = createPool(cfg.databaseUrl);
  const chain = new JsonRpcChainReader(rpcMapFrom(cfg));
  const deliver = webhookDeliver(cfg.outboxWebhookUrl);

  // Guardrails: evaluated every cycle, one email per condition per hour.
  const send = brevoSender({
    apiKey: process.env.BREVO_API_KEY ?? '',
    toEmail: process.env.GUARDRAIL_ALERT_TO ?? '',
    fromEmail: process.env.GUARDRAIL_ALERT_FROM ?? 'alerts@satelink.network',
    fromName: 'Satelink Guardrails',
  });
  const volumeCapacityBytes = Number(process.env.RECONCILER_VOLUME_BYTES ?? String(5 * GB)) || 5 * GB;
  const guardrails = async (): Promise<void> => {
    // Log every cycle so "the guardrails are running" is OBSERVABLE. Before this,
    // a successful evaluation logged nothing — only failures logged (fail-open-
    // silent), so a healthy cycle was indistinguishable from the hook never being
    // invoked. The 2026-08-28 outage exposed this: the only guardrail evidence was
    // a FAILURE line; there was no way to confirm a successful post-recovery cycle.
    const r = await runGuardrails(pool, { send, volumeCapacityBytes, windowMs: 3_600_000 });
    console.info(`[reconciler] guardrails evaluated=${r.evaluated} sent=${r.sent}`);
  };

  const server = startHttpServer({ db: pool, internalToken: cfg.internalToken, port: cfg.port });
  const scheduler = startScheduler(pool, chain, cfg, deliver, console, guardrails);

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
