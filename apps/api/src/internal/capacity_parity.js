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

export function createCapacityParityRouter() {
  const router = Router();
  router.get('/capacity-parity', (_req, res) => {
    try {
      const snap = parityRecorder.snapshot();
      res.json({ ...snap, active_path: enforcementPath() });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message ?? 'parity snapshot failed' });
    }
  });
  return router;
}
