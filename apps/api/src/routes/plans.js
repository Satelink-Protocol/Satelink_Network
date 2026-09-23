// Track B (P3.B) — GET /v1/plans. Read-only plan catalogue; the pricing-parity
// source for the web (§4.4). Additive; no money-path coupling.
import express from 'express';
import { listPlans, getPlan } from '../plans/plans_service.mjs';

export function createPlansRouter(pool) {
  const router = express.Router();

  router.get('/plans', async (_req, res) => {
    try {
      const plans = await listPlans(pool);
      res.json({ ok: true, plans });
    } catch (err) {
      console.error('[plans] list failed:', err.message);
      res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  router.get('/plans/:id', async (req, res) => {
    try {
      const plan = await getPlan(pool, req.params.id);
      if (!plan) return res.status(404).json({ ok: false, error: 'not_found' });
      res.json({ ok: true, plan });
    } catch (err) {
      console.error('[plans] get failed:', err.message);
      res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  return router;
}
