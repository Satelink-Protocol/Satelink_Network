// vNext kernel HTTP surface — mounts the DurableKernel into the live app.
//
// SAFETY: gated behind VNEXT_KERNEL_ENABLED (default OFF). When disabled the
// router is fully inert — every route returns 503 and NO database access, DDL,
// or kernel boot happens. Enabling is a deliberate human decision (per the
// vNext non-negotiable rules: new env vars ship defaults-off). Even when
// enabled, boot failures are contained (503 on vnext routes) and never crash
// the host app or the live money path.
//
// This first wiring exposes lifecycle + observability only (health, journal
// read). No workload adapters are registered and there is no submit endpoint,
// so no money can move through this surface yet — that is deliberate.

import express from 'express';
import { PgDurableStore } from '../reliability/pg_durable_store.js';
import { DurableKernel } from '../reliability/durable_kernel.js';
import { Registry } from '../kernel/registry.js';

// Inert settlement so DurableKernel.boot() has a valid dependency; unused
// because no workload adapters are registered (nothing routes/settles).
const INERT_SETTLEMENT = {
  capabilities: () => ({ modes: ['POST'], units: [], finality: 'INSTANT' }),
  async settleIn() { return { ref: null }; },
  async settleOut() { return { ref: null }; },
  async verify() { return { status: 'settled' }; },
};

export function createVnextKernelRouter(pool, { logger = console } = {}) {
  const router = express.Router();
  const enabled = process.env.VNEXT_KERNEL_ENABLED === 'true';

  if (!enabled) {
    // Fully inert: no DB, no boot. Uniform 503 on every vnext route.
    router.use((_req, res) => res.status(503).json({ ok: false, error: 'vnext kernel disabled' }));
    return router;
  }

  let dk = null;
  let bootErr = null;
  // Boot in the background so createApp() stays synchronous and a slow/failed
  // boot never blocks or crashes app startup.
  const ready = (async () => {
    const store = new PgDurableStore(pool);
    await store.init(); // additive vnext_* tables only
    dk = await DurableKernel.boot({
      store,
      registry: new Registry(), // no workload adapters yet (inert money path)
      settlement: INERT_SETTLEMENT,
      clock: () => Date.now(),
      useDurableSuppliers: true,
    });
    if (process.env.VNEXT_RECOVERY_TIMER_ENABLED === 'true') {
      dk.startRecoveryTimer({
        intervalMs: Number(process.env.VNEXT_RECOVERY_INTERVAL_MS || 30000),
        onError: (e) => logger.error('[vnext] recovery sweep error:', e && e.message ? e.message : e),
      });
      logger.log('[vnext] recovery timer started');
    }
    logger.log('[vnext] durable kernel booted');
  })().catch((e) => { bootErr = e; logger.error('[vnext] boot failed:', e && e.message ? e.message : e); });

  const guard = async (res) => {
    await ready;
    if (bootErr) { res.status(503).json({ ok: false, error: 'vnext boot failed', detail: String(bootErr.message || bootErr) }); return false; }
    return true;
  };

  router.get('/health', async (_req, res) => {
    if (!(await guard(res))) return;
    res.json({
      ok: true,
      enabled: true,
      suppliers: dk.supplierRegistry ? dk.supplierRegistry.list().length : 0,
      journalEvents: dk.journal.all().length,
      chainValid: dk.journal.verifyChain(),
      recoveryTimer: !!dk.recoveryScheduler,
      lastRecovery: dk.lastRecovery || null,
    });
  });

  router.get('/journal/:txId', async (req, res) => {
    if (!(await guard(res))) return;
    const phases = dk.journal.read(req.params.txId).map((e) => ({ phase: e.phase, ts: e.ts }));
    res.json({ ok: true, txId: req.params.txId, phases });
  });

  return router;
}
