/**
 * Internal scheduler — self-scheduling loop, one cycle at a time (no overlap).
 * A cycle that throws is logged and the loop continues on the next tick;
 * halting is fail-open, so a transient DB/RPC error must not wedge the worker.
 */

import type pg from 'pg';
import type { ChainReader } from './ports/chain-reader.js';
import { runCycle, type CycleConfig } from './cycle.js';
import type { Deliver } from './outbox-publisher/publish.js';

export interface Scheduler {
  stop(): void;
}

export function startScheduler(
  pool: pg.Pool,
  chain: ChainReader,
  cfg: CycleConfig & { reconcileIntervalMs: number },
  deliver: Deliver,
  log: Pick<Console, 'info' | 'error'> = console,
  /** Optional post-cycle hook (guardrails). Runs fail-open — a throw here never
   *  wedges the loop and never affects the reconcile cycle itself. */
  afterCycle?: () => Promise<void>,
): Scheduler {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      const out = await runCycle(pool, chain, cfg, deliver, new Date());
      const s = out.snapshot;
      log.info(
        `[reconciler] cycle done drift=${s.driftMinorUnits.toString()} halted=${String(s.halted)} ` +
          `reconciled=${s.reconciledCount} stuck=${s.stuckSettlementCount} advanced=${out.advancedCount} ` +
          `published=${out.publishedCount} schedule_transitions=${out.scheduleTransitions} ms=${s.cycleDurationMs}`,
      );
    } catch (err) {
      log.error('[reconciler] cycle failed (fail-open, retrying next tick):', err);
    }
    if (afterCycle) {
      try {
        await afterCycle();
      } catch (err) {
        log.error('[reconciler] guardrails failed (fail-open):', err);
      }
    }
    if (!stopped) timer = setTimeout(() => void tick(), cfg.reconcileIntervalMs);
  };

  void tick();

  return {
    stop(): void {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
    },
  };
}
