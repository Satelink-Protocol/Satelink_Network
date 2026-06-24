/**
 * API Key Management Routes
 * S1-RPC-011: Self-service API key creation flow
 *
 * Endpoints:
 * - POST /api/keys/create — Generate new API key
 * - POST /api/keys/validate — Validate API key
 * - GET /api/keys/usage — Get usage stats
 * - DELETE /api/keys/revoke — Revoke API key
 */

import { Router } from 'express';
import crypto from 'crypto';
import { getSharedRedis } from '../../workloads/rpc_gateway/shared_redis.js';

const PLAN_LIMITS = {
  free: { limit: 500, tier: 'free' },
  basic: { limit: 10000, tier: 'basic' },
  pro: { limit: 100000, tier: 'pro' },
  enterprise: { limit: 1000000, tier: 'enterprise' }
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Use shared Redis client to avoid connection pool exhaustion
function getRedis() {
  return getSharedRedis();
}

function generateApiKey() {
  return `sk_live_${crypto.randomBytes(16).toString('hex')}`;
}

function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function getKeyPrefix(key) {
  return key.slice(0, 12) + '...';
}

function getDateKey() {
  return new Date().toISOString().slice(0, 10);
}

async function ensureTable(db) {
  if (!db || !db.query) return;

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS rpc_api_keys (
        id SERIAL PRIMARY KEY,
        key_hash TEXT UNIQUE NOT NULL,
        key_prefix TEXT NOT NULL,
        email TEXT NOT NULL,
        plan TEXT NOT NULL DEFAULT 'free',
        tier TEXT NOT NULL DEFAULT 'free',
        daily_limit INTEGER NOT NULL DEFAULT 100,
        status TEXT NOT NULL DEFAULT 'active',
        created_at BIGINT NOT NULL,
        last_used_at BIGINT,
        total_requests INTEGER DEFAULT 0
      )
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_rpc_api_keys_email ON rpc_api_keys(email)
    `);
  } catch (err) {
    console.error('[ApiKeys] Table creation failed:', err.message);
  }
}

async function checkEmailRateLimit(redisClient, email) {
  if (!redisClient) return { allowed: true };

  const date = getDateKey();
  const key = `rpc:keycreate:${email}:${date}`;

  try {
    const count = parseInt(await redisClient.get(key)) || 0;
    if (count >= 3) {
      return { allowed: false, message: 'Max 3 API keys per email per day' };
    }
    return { allowed: true, count };
  } catch (err) {
    return { allowed: true };
  }
}

async function incrementEmailKeyCount(redisClient, email) {
  if (!redisClient) return;

  const date = getDateKey();
  const key = `rpc:keycreate:${email}:${date}`;

  try {
    await redisClient.incr(key);
    await redisClient.expire(key, 86400 * 2);
  } catch (err) {
    console.error('[ApiKeys] Failed to increment key count:', err.message);
  }
}

async function sendDiscordNotification(email, plan, keyPrefix) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Satelink API',
        embeds: [{
          title: '🔑 New API Key Created',
          color: 0x00ff00,
          fields: [
            { name: 'Email', value: email, inline: true },
            { name: 'Plan', value: plan, inline: true },
            { name: 'Key Prefix', value: keyPrefix, inline: true }
          ],
          timestamp: new Date().toISOString()
        }]
      })
    });
  } catch (err) {
    console.error('[ApiKeys] Discord notification failed:', err.message);
  }
}

export function createApiKeysRouter(db) {
  const router = Router();

  ensureTable(db);

  // Simple POST / — create free tier key without email (for plans page)
  router.post('/', async (req, res) => {
    try {
      const { tier = 'free', wallet_address } = req.body || {};

      if (tier !== 'free') {
        return res.status(400).json({
          ok: false,
          error: 'Only free tier available via self-service',
          upgrade_url: 'https://app.satelink.network/satelink/os/plans'
        });
      }

      const apiKey = generateApiKey();
      const keyHash = hashApiKey(apiKey);
      const keyPrefix = getKeyPrefix(apiKey);
      const planConfig = PLAN_LIMITS[tier];
      const now = Math.floor(Date.now() / 1000);

      if (db && db.query) {
        await db.query(
          `INSERT INTO rpc_api_keys (key_hash, key_prefix, email, plan, tier, daily_limit, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)`,
          [keyHash, keyPrefix, wallet_address || 'self-service', tier, planConfig.tier, planConfig.limit, now]
        );
      }

      // Redis is optional - don't fail if unavailable
      try {
        const redisClient = getRedis();
        if (redisClient) {
          await redisClient.set(
            `rpc:apikey:${apiKey}`,
            JSON.stringify({ tier: planConfig.tier, plan: tier, created: now, status: 'active' })
          );
        }
      } catch (redisErr) {
        console.warn('[ApiKeys] Redis unavailable, continuing with DB only:', redisErr.message);
      }

      console.log(`[ApiKeys] Created self-service: ${keyPrefix} tier=${tier}`);

      res.json({
        ok: true,
        api_key: apiKey,
        tier,
        daily_limit: planConfig.limit,
        usage: `Add header: X-API-Key: ${apiKey}`,
        example: `curl -X POST https://rpc.satelink.network/rpc/polygon -H "X-API-Key: ${apiKey}" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`,
        docs: 'https://docs.satelink.network'
      });
    } catch (err) {
      console.error('[ApiKeys] Self-service create error:', err.message, err.stack);
      res.status(500).json({ ok: false, error: 'Failed to create API key', reason: err.message });
    }
  });

  router.post('/create', async (req, res) => {
    try {
      const { email, plan = 'basic' } = req.body || {};

      if (!email || !EMAIL_REGEX.test(email)) {
        return res.status(400).json({
          ok: false,
          error: 'Valid email required'
        });
      }

      if (!PLAN_LIMITS[plan]) {
        return res.status(400).json({
          ok: false,
          error: `Invalid plan. Valid: ${Object.keys(PLAN_LIMITS).join(', ')}`
        });
      }

      const redisClient = getRedis();
      const rateCheck = await checkEmailRateLimit(redisClient, email);
      if (!rateCheck.allowed) {
        return res.status(429).json({ ok: false, error: rateCheck.message });
      }

      const apiKey = generateApiKey();
      const keyHash = hashApiKey(apiKey);
      const keyPrefix = getKeyPrefix(apiKey);
      const planConfig = PLAN_LIMITS[plan];
      const now = Math.floor(Date.now() / 1000);

      if (db && db.query) {
        await db.query(
          `INSERT INTO rpc_api_keys (key_hash, key_prefix, email, plan, tier, daily_limit, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)`,
          [keyHash, keyPrefix, email, plan, planConfig.tier, planConfig.limit, now]
        );
      }

      // Redis operations are optional - don't fail if unavailable
      try {
        await incrementEmailKeyCount(redisClient, email);
        if (redisClient) {
          await redisClient.set(
            `rpc:apikey:${apiKey}`,
            JSON.stringify({ tier: planConfig.tier, email, plan, created: now, status: 'active' })
          );
        }
      } catch (redisErr) {
        console.warn('[ApiKeys] Redis unavailable:', redisErr.message);
      }

      await sendDiscordNotification(email, plan, keyPrefix);

      console.log(`[ApiKeys] Created: ${keyPrefix} plan=${plan} email=${email}`);

      res.json({
        ok: true,
        apiKey,
        plan,
        tier: planConfig.tier,
        dailyLimit: planConfig.limit,
        message: 'Store this key securely — it cannot be retrieved again'
      });
    } catch (err) {
      console.error('[ApiKeys] Create error:', err.message, err.stack);
      res.status(500).json({ ok: false, error: 'Failed to create API key', reason: err.message });
    }
  });

  router.post('/validate', async (req, res) => {
    try {
      const apiKey = req.headers['x-api-key'];

      if (!apiKey || !apiKey.startsWith('sk_live_')) {
        return res.status(400).json({ ok: false, valid: false, error: 'Invalid API key format' });
      }

      const keyHash = hashApiKey(apiKey);

      if (db && db.query) {
        const result = await db.query(
          'SELECT plan, tier, daily_limit, status FROM rpc_api_keys WHERE key_hash = $1',
          [keyHash]
        );

        if (result.rows.length === 0) {
          return res.json({ ok: true, valid: false, error: 'API key not found' });
        }

        const row = result.rows[0];

        if (row.status !== 'active') {
          return res.json({ ok: true, valid: false, error: 'API key revoked' });
        }

        const date = getDateKey();
        const redisClient = getRedis();
        let usedToday = 0;

        if (redisClient) {
          usedToday = parseInt(await redisClient.get(`rpc:usage:${apiKey}:${date}`)) || 0;
        }

        res.json({
          ok: true,
          valid: true,
          plan: row.plan,
          tier: row.tier,
          dailyLimit: row.daily_limit,
          usedToday,
          remainingToday: Math.max(0, row.daily_limit - usedToday)
        });
      } else {
        const redisClient = getRedis();
        if (!redisClient) {
          return res.status(503).json({ ok: false, error: 'Database unavailable' });
        }

        const data = await redisClient.get(`rpc:apikey:${apiKey}`);
        if (!data) {
          return res.json({ ok: true, valid: false, error: 'API key not found' });
        }

        const keyInfo = JSON.parse(data);
        if (keyInfo.status !== 'active') {
          return res.json({ ok: true, valid: false, error: 'API key revoked' });
        }

        const date = getDateKey();
        const usedToday = parseInt(await redisClient.get(`rpc:usage:${apiKey}:${date}`)) || 0;
        const limit = PLAN_LIMITS[keyInfo.plan]?.limit || 100;

        res.json({
          ok: true,
          valid: true,
          plan: keyInfo.plan,
          tier: keyInfo.tier,
          dailyLimit: limit,
          usedToday,
          remainingToday: Math.max(0, limit - usedToday)
        });
      }
    } catch (err) {
      console.error('[ApiKeys] Validate error:', err.message);
      res.status(500).json({ ok: false, error: 'Validation failed' });
    }
  });

  router.get('/usage', async (req, res) => {
    try {
      const apiKey = req.headers['x-api-key'];

      if (!apiKey || !apiKey.startsWith('sk_live_')) {
        return res.status(400).json({ ok: false, error: 'API key required in x-api-key header' });
      }

      const keyHash = hashApiKey(apiKey);
      const date = getDateKey();
      const redisClient = getRedis();

      let usedToday = 0;
      if (redisClient) {
        usedToday = parseInt(await redisClient.get(`rpc:usage:${apiKey}:${date}`)) || 0;
      }

      if (db && db.query) {
        const result = await db.query(
          'SELECT plan, tier, daily_limit, status, total_requests FROM rpc_api_keys WHERE key_hash = $1',
          [keyHash]
        );

        if (result.rows.length === 0) {
          return res.status(404).json({ ok: false, error: 'API key not found' });
        }

        const row = result.rows[0];

        if (row.status !== 'active') {
          return res.status(403).json({ ok: false, error: 'API key revoked' });
        }

        const totalRevenueResult = await db.query(
          `SELECT COALESCE(SUM(amount_usdt), 0) as total
           FROM revenue_events_v2
           WHERE client_id = $1`,
          [apiKey]
        );

        res.json({
          ok: true,
          plan: row.plan,
          tier: row.tier,
          dailyLimit: row.daily_limit,
          usedToday,
          remainingToday: Math.max(0, row.daily_limit - usedToday),
          totalRequests: row.total_requests || 0,
          totalSpentUsdt: parseFloat(totalRevenueResult.rows[0]?.total) || 0
        });
      } else {
        res.status(503).json({ ok: false, error: 'Database unavailable' });
      }
    } catch (err) {
      console.error('[ApiKeys] Usage error:', err.message);
      res.status(500).json({ ok: false, error: 'Failed to get usage' });
    }
  });

  router.delete('/revoke', async (req, res) => {
    try {
      const apiKey = req.headers['x-api-key'];

      if (!apiKey || !apiKey.startsWith('sk_live_')) {
        return res.status(400).json({ ok: false, error: 'API key required in x-api-key header' });
      }

      const keyHash = hashApiKey(apiKey);

      if (db && db.query) {
        const result = await db.query(
          "UPDATE rpc_api_keys SET status = 'revoked' WHERE key_hash = $1 AND status = 'active' RETURNING id",
          [keyHash]
        );

        if (result.rows.length === 0) {
          return res.status(404).json({ ok: false, error: 'API key not found or already revoked' });
        }
      }

      const redisClient = getRedis();
      if (redisClient) {
        const data = await redisClient.get(`rpc:apikey:${apiKey}`);
        if (data) {
          const keyInfo = JSON.parse(data);
          keyInfo.status = 'revoked';
          await redisClient.set(`rpc:apikey:${apiKey}`, JSON.stringify(keyInfo));
        }
      }

      console.log(`[ApiKeys] Revoked: ${getKeyPrefix(apiKey)}`);

      res.json({ ok: true, message: 'API key revoked' });
    } catch (err) {
      console.error('[ApiKeys] Revoke error:', err.message);
      res.status(500).json({ ok: false, error: 'Failed to revoke API key' });
    }
  });

  return router;
}
