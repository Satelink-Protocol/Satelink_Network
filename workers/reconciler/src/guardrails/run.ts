/**
 * Guardrail orchestration: collect metrics → evaluate → fire-once dedup → deliver.
 * Runs every reconciler cycle; the fire-once window (default 1h) keeps it to one
 * email per condition per hour even though it evaluates every ~30s. Fail-open:
 * a throw here is caught by the caller so the reconciler loop is never wedged.
 */

import type pg from 'pg';
import { evaluateGuardrails, filterFireOnce } from './evaluate.js';
import { collectMetrics } from './metrics.js';
import { loadThresholds } from './thresholds.js';
import { loadAlertState, recordSent, type SendAlert } from './notify.js';

export interface RunGuardrailsDeps {
  readonly send: SendAlert;
  readonly volumeCapacityBytes: number;
  readonly windowMs: number; // fire-once window, default 3_600_000
  readonly nowMs?: number; // injectable clock for tests
}

export interface GuardrailRunResult {
  readonly evaluated: number;
  readonly sent: number;
}

export async function runGuardrails(pool: pg.Pool, deps: RunGuardrailsDeps): Promise<GuardrailRunResult> {
  const nowMs = deps.nowMs ?? Date.now();
  const thresholds = await loadThresholds(pool);
  const metrics = await collectMetrics(pool, {
    volumeCapacityBytes: deps.volumeCapacityBytes,
    driverStaleMinutes: thresholds.driverStaleMinutes,
  });
  const alerts = evaluateGuardrails(metrics, thresholds);
  const state = await loadAlertState(pool);
  const { toSend } = filterFireOnce(alerts, state, nowMs, deps.windowMs);

  for (const alert of toSend) {
    await deps.send(alert);
  }
  await recordSent(pool, toSend.map((a) => a.key), nowMs);

  return { evaluated: alerts.length, sent: toSend.length };
}
