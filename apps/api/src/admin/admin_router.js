/**
 * Admin Command Center router.
 *
 * Built against the real repo (corrected vs the original design doc):
 *   - Factory `createAdminRouter(pool, redis)` closing over deps — matches every
 *     other router in app_factory.mjs. No reliance on req.db / req.redis.
 *   - Auth via ADMIN_SECRET_TOKEN (the x-admin-token header). The Vercel proxy
 *     (apps/web/.../api/admin-proxy) holds the matching value server-side as
 *     ADMIN_TOKEN so it never reaches the browser.
 *   - No /settlement/refund-signer endpoint. See comment in the Settlement
 *     section: signer refund is a one-time manual CLI command.
 */

import express from 'express';
import { IpClassifier }         from './jobs/ip_classifier.js';
import { OutreachEngine }       from './jobs/outreach_engine.js';
import { SettlementControl }    from './jobs/settlement_control.js';
import { CustomerZeroDetector } from './jobs/customer_zero_detector.js';

export function requireAdminAuth(req, res, next) {
  const expected = process.env.ADMIN_SECRET_TOKEN;
  if (!expected) {
    return res.status(503).json({ ok: false, error: 'ADMIN_SECRET_TOKEN not configured' });
  }
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token || token !== expected) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  next();
}

export function createAdminRouter(pool, redis) {
  const router = express.Router();
  const q = async (sql, params) => (await pool.query(sql, params)).rows;
  const log = async (job, action, result) => {
    try {
      await pool.query(
        `INSERT INTO automation_logs (job_name, action, result) VALUES ($1,$2,$3)`,
        [job, action, JSON.stringify(result)]
      );
    } catch { /* automation_logs may not exist until migration runs */ }
  };

  // ── Intelligence ──────────────────────────────────────────────────────────
  router.get('/intel/developers', async (req, res) => {
    try {
      const rows = await q(
        `SELECT * FROM developer_intel WHERE classification IN ('developer','machine') ORDER BY score DESC, days_active DESC`
      );
      res.json({ ok: true, developers: rows, count: rows.length });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  router.post('/intel/classify', async (req, res) => {
    try {
      const result = await new IpClassifier(pool, redis).run();
      await log('ip-classifier', 'manual trigger', result);
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  router.patch('/intel/developer/:ip/stage', async (req, res) => {
    const { stage, notes } = req.body || {};
    const valid = ['identified', 'contacted', 'deposited', 'paid'];
    if (!valid.includes(stage)) return res.status(400).json({ ok: false, error: 'Invalid stage' });
    try {
      await q(
        `UPDATE developer_intel SET status=$1, notes=COALESCE($2,notes),
           outreach_attempts = CASE WHEN $1='contacted' THEN outreach_attempts+1 ELSE outreach_attempts END,
           last_outreach_at  = CASE WHEN $1='contacted' THEN NOW() ELSE last_outreach_at END,
           updated_at = NOW() WHERE ip=$3`,
        [stage, notes, req.params.ip]
      );
      await log('stage_update', `${req.params.ip} → ${stage}`, {});
      res.json({ ok: true, ip: req.params.ip, stage });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ── Outreach ──────────────────────────────────────────────────────────────
  router.get('/outreach/campaigns', async (req, res) => {
    try {
      const rows = await q(`SELECT * FROM outreach_campaigns ORDER BY created_at DESC LIMIT 50`);
      res.json({ ok: true, campaigns: rows });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  router.post('/outreach/discord/post', async (req, res) => {
    const { templateId, body, target, webhookUrl } = req.body || {};
    try {
      const engine = new OutreachEngine(pool);
      const result = await engine.sendDiscord(templateId || 'erpc-provider', webhookUrl);

      if (body && !templateId) {
        const url = webhookUrl || process.env.DISCORD_WEBHOOK_URL;
        if (url) {
          await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: body, username: 'Satelink' }),
          });
        }
      }

      await log('outreach', `Discord post: ${target || templateId || 'erpc-provider'}`, result);
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ── Settlement ──────────────────────────────────────────────────────────────
  router.get('/settlement/status', async (req, res) => {
    try { res.json({ ok: true, ...(await new SettlementControl(pool).getStatus()) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  router.post('/settlement/dry-run', async (req, res) => {
    const { enabled } = req.body || {};
    try {
      const result = await new SettlementControl(pool).setDryRun(!!enabled);
      await log('dry_run', `set to ${enabled}`, result);
      res.json({ ok: true, dryRun: !!enabled, ...result });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Signer refund is a ONE-TIME manual CLI command, not an API endpoint.
  // Run manually: node scripts/refund_signer.js
  // Reason: private key must never live in Railway environment variables.

  // ── Jobs ──────────────────────────────────────────────────────────────────
  router.get('/jobs/status', async (req, res) => {
    try {
      const rows = await q(
        `SELECT DISTINCT ON (job_name) job_name, action, result, created_at FROM automation_logs ORDER BY job_name, created_at DESC`
      );
      res.json({ ok: true, jobs: rows });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  router.post('/jobs/trigger/:jobId', async (req, res) => {
    const jobs = {
      'ip-classifier': () => new IpClassifier(pool, redis).run(),
      'customer-zero': () => new CustomerZeroDetector(pool).run(),
      'outreach':      () => new OutreachEngine(pool).run(),
    };
    const fn = jobs[req.params.jobId];
    if (!fn) return res.status(404).json({ ok: false, error: `Unknown job: ${req.params.jobId}` });
    try {
      const result = await fn();
      await log(req.params.jobId, 'manual', result);
      res.json({ ok: true, jobId: req.params.jobId, result });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ── SSE Live Feed ───────────────────────────────────────────────────────────
  router.get('/live/feed', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    let lastId = 0;
    const send = d => res.write(`data: ${JSON.stringify(d)}\n\n`);
    send({ type: 'connected', ts: Date.now() });
    const iv = setInterval(async () => {
      try {
        const rows = await q(`SELECT * FROM automation_logs WHERE id > $1 ORDER BY id ASC LIMIT 20`, [lastId]);
        if (rows.length) { lastId = rows.at(-1).id; rows.forEach(r => send({ type: 'log', data: r })); }
      } catch { /* ignore transient query errors on the stream */ }
    }, 5000);
    req.on('close', () => clearInterval(iv));
  });

  return router;
}

export default createAdminRouter;
