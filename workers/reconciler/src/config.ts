/**
 * Worker configuration — read once from the environment at startup.
 *
 * The worker NEVER changes SETTLEMENT_DRY_RUN or any settlement flag. It only
 * reads: the database, chain RPCs, and its own tuning knobs.
 */

export interface WorkerConfig {
  readonly databaseUrl: string;
  readonly baseRpcUrl: string;
  readonly polygonRpcUrl: string;
  /** Minimum confirmations before a chain tx is treated as settled. */
  readonly minConfirmations: number;
  /** How long a draw may sit in `settling` before it counts as stuck (ms). */
  readonly stuckSettlementAgeMs: number;
  /** Interval between reconciler cycles (ms). */
  readonly reconcileIntervalMs: number;
  /** HTTP port for /internal/reconciliation + /health. */
  readonly port: number;
  /** Shared secret required on /internal/* requests. Empty = endpoint refuses. */
  readonly internalToken: string;
  /** Optional webhook the outbox-publisher POSTs events to. Empty = ack-only. */
  readonly outboxWebhookUrl: string;
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const databaseUrl = env.DATABASE_URL ?? '';
  if (databaseUrl.trim() === '') {
    throw new Error('DATABASE_URL is required');
  }
  return {
    databaseUrl,
    baseRpcUrl: env.BASE_RPC_URL ?? 'https://mainnet.base.org',
    polygonRpcUrl: env.POLYGON_RPC_URL ?? 'https://polygon-rpc.com',
    minConfirmations: intFromEnv('RECONCILER_MIN_CONFIRMATIONS', 5),
    stuckSettlementAgeMs: intFromEnv('STUCK_SETTLEMENT_AGE_MS', 15 * 60 * 1000),
    reconcileIntervalMs: intFromEnv('RECONCILE_INTERVAL_MS', 30_000),
    port: intFromEnv('PORT', 8080),
    internalToken: env.INTERNAL_TOKEN ?? '',
    outboxWebhookUrl: env.OUTBOX_WEBHOOK_URL ?? '',
  };
}
