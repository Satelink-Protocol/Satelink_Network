/**
 * S8-003: Webhook Delivery System
 *
 * POST /api/webhooks/register — register webhook subscription
 * GET /api/webhooks — list active webhooks
 * DELETE /api/webhooks/:id — deactivate webhook
 *
 * Revenue: $0.0001 per webhook delivery
 */

import { Router } from 'express';
import { isFounderApiKey } from '../../payments/founder_wallets.js';

const WEBHOOK_PRICE_USDT = 0.0001;

export function createWebhookRouter(pool, redis) {
  const router = Router();

  router.post('/register', async (req, res) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      return res.status(401).json({ ok: false, error: 'API key required' });
    }

    const { url, events, chain } = req.body;
    if (!url || !chain) {
      return res.status(400).json({ ok: false, error: 'url and chain required' });
    }

    const validEvents = ['new_block', 'epoch_close', 'settlement', 'price_alert'];
    const eventList = Array.isArray(events) ? events.filter(e => validEvents.includes(e)) : ['new_block'];

    try {
      const result = await pool.query(
        `INSERT INTO webhook_subscriptions (api_key, url, events, chain, status, created_at)
         VALUES ($1, $2, $3, $4, 'active', $5)
         RETURNING id`,
        [apiKey, url, JSON.stringify(eventList), chain, Math.floor(Date.now() / 1000)]
      );

      res.json({
        ok: true,
        webhookId: result.rows[0].id,
        url,
        events: eventList,
        chain,
        pricePerDelivery: `$${WEBHOOK_PRICE_USDT}`
      });
    } catch (err) {
      console.error('[Webhooks] Register failed:', err.message);
      res.status(500).json({ ok: false, error: 'Failed to register webhook' });
    }
  });

  router.get('/', async (req, res) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      return res.status(401).json({ ok: false, error: 'API key required' });
    }

    try {
      const result = await pool.query(
        `SELECT id, url, events, chain, status, created_at
         FROM webhook_subscriptions
         WHERE api_key = $1 AND status = 'active'
         ORDER BY created_at DESC`,
        [apiKey]
      );

      res.json({
        ok: true,
        webhooks: result.rows.map(r => ({
          id: r.id,
          url: r.url,
          events: r.events,
          chain: r.chain,
          createdAt: r.created_at
        })),
        count: result.rows.length
      });
    } catch (err) {
      console.error('[Webhooks] List failed:', err.message);
      res.status(500).json({ ok: false, error: 'Failed to list webhooks' });
    }
  });

  router.delete('/:id', async (req, res) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      return res.status(401).json({ ok: false, error: 'API key required' });
    }

    try {
      const result = await pool.query(
        `UPDATE webhook_subscriptions
         SET status = 'inactive'
         WHERE id = $1 AND api_key = $2
         RETURNING id`,
        [req.params.id, apiKey]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ ok: false, error: 'Webhook not found' });
      }

      res.json({ ok: true, deactivated: result.rows[0].id });
    } catch (err) {
      console.error('[Webhooks] Delete failed:', err.message);
      res.status(500).json({ ok: false, error: 'Failed to deactivate webhook' });
    }
  });

  return router;
}

export async function deliverWebhooks(pool, redis, chain, eventType, payload) {
  try {
    const subs = await pool.query(
      `SELECT id, url, api_key FROM webhook_subscriptions
       WHERE chain = $1 AND status = 'active' AND events::jsonb ? $2`,
      [chain, eventType]
    );

    let delivered = 0;
    for (const sub of subs.rows) {
      try {
        const response = await fetch(sub.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: eventType,
            chain,
            timestamp: Date.now(),
            data: payload
          }),
          signal: AbortSignal.timeout(5000)
        });

        if (response.ok) {
          delivered++;
          const isTestData = await isFounderApiKey(pool, sub.api_key);
          await pool.query(
            `INSERT INTO revenue_events_v2 (client_id, service, method, amount_usdt, status, created_at, is_test_data, is_billable)
             VALUES ($1, 'webhook', $2, $3, 'completed', $4, $5, false)`,
            [sub.api_key, eventType, WEBHOOK_PRICE_USDT, Math.floor(Date.now() / 1000), isTestData]
          );
        }
      } catch (e) {
        console.error(`[Webhooks] Delivery to ${sub.url} failed:`, e.message);
      }
    }

    return { delivered, total: subs.rows.length };
  } catch (err) {
    console.error('[Webhooks] deliverWebhooks failed:', err.message);
    return { delivered: 0, total: 0 };
  }
}

export async function ensureWebhookTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS webhook_subscriptions (
      id SERIAL PRIMARY KEY,
      api_key TEXT NOT NULL,
      url TEXT NOT NULL,
      events JSONB DEFAULT '[]',
      chain TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      created_at BIGINT
    )
  `);
}
