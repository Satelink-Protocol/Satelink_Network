/**
 * SDK Analytics Endpoint
 * S4-005: Track SDK usage for insights
 *
 * POST /api/sdk/ping
 * Records: sdk_version, chain, method_count, api_key
 * Store in Redis: sdk:usage:{keyRef(apiKey)}:{date}  (never the key)
 */

import { Router } from 'express';
import { keyRef } from '../../security/key_mask.mjs';
import { getSharedRedis } from './shared_redis.js';

// Use shared Redis client to avoid connection pool exhaustion
function getRedis() {
  return getSharedRedis();
}

export function createSdkAnalyticsRouter() {
  const router = Router();

  router.post('/sdk/ping', async (req, res) => {
    try {
      const {
        sdk_version,
        chain,
        method_count,
        methods,
        session_id
      } = req.body;

      const apiKey = req.headers['x-api-key'] || 'public';
      const today = new Date().toISOString().split('T')[0];
      const client = getRedis();

      if (client) {
        const key = `sdk:usage:${keyRef(apiKey)}:${today}`;

        await client.hincrby(key, 'pings', 1);
        await client.hincrby(key, 'method_count', method_count || 0);

        if (sdk_version) {
          await client.hset(key, 'sdk_version', sdk_version);
        }
        if (chain) {
          await client.hincrby(key, `chain:${chain}`, 1);
        }
        if (methods && Array.isArray(methods)) {
          for (const method of methods.slice(0, 10)) {
            await client.hincrby(key, `method:${method}`, 1);
          }
        }

        await client.expire(key, 7 * 24 * 60 * 60);
      }

      res.json({
        ok: true,
        recorded: true,
        timestamp: Date.now()
      });
    } catch (err) {
      console.error('[SDK Analytics] Error:', err.message);
      res.json({ ok: true, recorded: false });
    }
  });

  router.get('/sdk/stats', async (req, res) => {
    try {
      const apiKey = req.headers['x-api-key'] || req.query.api_key || 'public';
      const today = new Date().toISOString().split('T')[0];
      const client = getRedis();

      if (!client) {
        return res.json({ ok: true, stats: null, reason: 'Redis not configured' });
      }

      const key = `sdk:usage:${keyRef(apiKey)}:${today}`;
      const data = await client.hgetall(key);

      const stats = {
        pings: parseInt(data.pings, 10) || 0,
        method_count: parseInt(data.method_count, 10) || 0,
        sdk_version: data.sdk_version || 'unknown',
        chains: {},
        methods: {}
      };

      for (const [k, v] of Object.entries(data)) {
        if (k.startsWith('chain:')) {
          stats.chains[k.replace('chain:', '')] = parseInt(v, 10) || 0;
        }
        if (k.startsWith('method:')) {
          stats.methods[k.replace('method:', '')] = parseInt(v, 10) || 0;
        }
      }

      res.json({ ok: true, date: today, stats });
    } catch (err) {
      console.error('[SDK Analytics] Stats error:', err.message);
      res.status(500).json({ ok: false, error: 'Failed to fetch stats' });
    }
  });

  return router;
}
