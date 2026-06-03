/**
 * S6-007: Economy Commander — Machine Revenue Operating System
 *
 * Aggregates status from all autonomous revenue modules:
 * - Treasury monitor (MATIC/USDT balances)
 * - Revenue anomaly detector (velocity, drops, spikes)
 * - Capacity alerter (node utilization)
 * - RPC healer (chain health)
 *
 * Provides a single /system/economy endpoint and startup routine.
 * Redis-optional: falls back to direct module calls when redis is null.
 */

import { getTreasuryStatus, checkTreasury } from './treasury_monitor.js';
import { getAnomalyStats } from './revenue_anomaly.js';
import { getCapacityStats } from './capacity_alerter.js';
import { getHealerStats } from './rpc_healer.js';
import { Router } from 'express';

let _pool = null;
let _redis = null;
let _status = null;
let _lastCheck = 0;

const STATUS_TTL_MS = 60000; // 1 min in-memory cache

export async function getEconomyStatus() {
  const now = Date.now();
  if (_status && now - _lastCheck < STATUS_TTL_MS) return _status;

  const [treasury, anomaly, capacity, healer] = await Promise.allSettled([
    getTreasuryStatus(_redis).then(s => s || checkTreasury(_redis)),
    getAnomalyStats(_pool, _redis),
    getCapacityStats(_pool, _redis),
    getHealerStats('polygon-amoy'),
  ]);

  _status = {
    ok: true,
    timestamp: now,
    treasury: treasury.status === 'fulfilled' ? treasury.value : { ok: false, error: treasury.reason?.message },
    anomaly: anomaly.status === 'fulfilled' ? anomaly.value : { ok: false, error: anomaly.reason?.message },
    capacity: capacity.status === 'fulfilled' ? capacity.value : { ok: false, error: capacity.reason?.message },
    healer: healer.status === 'fulfilled' ? healer.value : { ok: false, error: healer.reason?.message },
  };
  _lastCheck = now;
  return _status;
}

export function createEconomyCommanderRouter() {
  const router = Router();

  router.get('/system/economy', async (req, res) => {
    try {
      const status = await getEconomyStatus();
      res.json(status);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}

export async function startEconomyCommander(pool, redis = null) {
  _pool = pool;
  _redis = redis;
  console.log('[Economy-Commander] Started — aggregating autonomous module status');

  try {
    await getEconomyStatus();
    console.log('[Economy-Commander] Initial status snapshot complete');
  } catch (e) {
    console.warn('[Economy-Commander] Initial snapshot failed (non-fatal):', e.message);
  }
}
