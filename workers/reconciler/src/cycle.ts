/**
 * One reconciliation cycle: reconcile → poll → monitor → publish, then persist
 * the single-row snapshot the /internal/reconciliation endpoint serves.
 *
 * Runs against any Queryable, so the exit-gate drift test can drive a cycle
 * inside a BEGIN…ROLLBACK transaction (nothing persists) and read the same
 * snapshot the scheduler would have written.
 */

import type { Queryable } from './db.js';
import type { ChainReader } from './ports/chain-reader.js';
import { reconcileOnce } from './reconciler/reconcile.js';
import { pollOnce } from './settlement-poller/poll.js';
import { monitorSchedules } from './refill-monitor/monitor.js';
import { publishOnce, type Deliver } from './outbox-publisher/publish.js';
import { writeReconciliationState, type ReconciliationSnapshot } from './state.js';

export interface CycleConfig {
  readonly minConfirmations: number;
  readonly stuckSettlementAgeMs: number;
}

export interface CycleOutcome {
  readonly snapshot: ReconciliationSnapshot;
  readonly advancedCount: number;
  readonly publishedCount: number;
  readonly scheduleTransitions: number;
}

export async function runCycle(
  exec: Queryable,
  chain: ChainReader,
  cfg: CycleConfig,
  deliver: Deliver,
  now: Date,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CycleOutcome> {
  const startedMs = Date.now();

  const reconcile = await reconcileOnce(exec, chain, cfg, env);
  const poll = await pollOnce(exec, chain, cfg, now);

  // M9: monitor nonce schedules for transitions before publishing, so any
  // events the monitor emits are drained in the same cycle's publish pass.
  let scheduleTransitions = 0;
  try {
    const monitor = await monitorSchedules(exec, now);
    scheduleTransitions = monitor.transitionsDetected;
  } catch (err) {
    // Monitor failure must not break the reconciler cycle.
    console.error('[reconciler] schedule monitor failed (non-fatal):', err);
  }

  const publish = await publishOnce(exec, deliver);

  const snapshot: ReconciliationSnapshot = {
    lastRunAt: now,
    driftMinorUnits: reconcile.driftMinorUnits,
    halted: reconcile.halted,
    haltReason: reconcile.haltReason,
    stuckSettlementCount: poll.stuckSettlementCount,
    reconciledCount: reconcile.reconciledCount,
    cycleDurationMs: Date.now() - startedMs,
  };
  await writeReconciliationState(exec, snapshot);

  return {
    snapshot,
    advancedCount: poll.advancedCount,
    publishedCount: publish.publishedCount,
    scheduleTransitions,
  };
}
