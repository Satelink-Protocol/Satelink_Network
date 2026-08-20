/**
 * Capacity parity endpoint (M8 — capacity enforcement cutover).
 *
 * GET /internal/capacity-parity — reports the dual-evaluation window: decisions
 * evaluated, agreements, disagreements by reason, and p50/p99 latency per path
 * (legacy vs new) plus the new−legacy p99 delta. READ-ONLY; the counters are
 * process-local (see parity_recorder.js) and hold no secrets.
 *
 * The gate uses this: a meaningful cutover requires the served (legacy) and
 * candidate (new) paths to AGREE across the window, with the new-path p99 delta
 * under 10ms.
 */

import { Router } from 'express';
import { parityRecorder } from '../capacity/parity_recorder.js';
import { enforcementPath } from '../capacity/capacity_enforcement.js';
import { getCapacityPath } from '../lib/flags.js';

export function createCapacityParityRouter(pool) {
  const router = Router();
  router.get('/capacity-parity', async (_req, res) => {
    try {
      const snap = parityRecorder.snapshot();
      // Report BOTH the authoritative served path (platform_flags via
      // getCapacityPath — the same source enforceCapacity() decides on) AND the
      // env var, so any drift between them is visible rather than hidden during
      // the unattended M9 live test (issue #323). getCapacityPath fails closed
      // to 'legacy' and never throws.
      res.json({
        ...snap,
        enforcement_path_active: await getCapacityPath(pool), // DB — authoritative
        enforcement_path_env: enforcementPath(),               // env — legacy, informational
        flag_source: 'platform_flags',
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message ?? 'parity snapshot failed' });
    }
  });
  return router;
}
