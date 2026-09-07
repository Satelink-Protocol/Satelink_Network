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
import { emailRouter }          from './email.js';
import {
  evaluatePricing, latestDecision, pricingMode,
  getMarketSnapshot, getConversionFunnel, getIntelSummary,
  upsertCompetitorPricePoint,
} from '../economics/pricing_intelligence/index.js';
import { PRICE_PER_CALL_USDT } from '../billing/credit_service.mjs';

// Mirrors BAD_ASNS in apps/api/src/middleware/free_tier_gate.js — kept as a
// separate literal here rather than imported so the admin router has no
// runtime dependency on the rate-limit middleware module.
const BAD_ASNS = new Set(['AS135905', 'AS63737', 'AS135464']);

// Safe Redis key scan (SCAN cursor, never KEYS) — same pattern as
// ip_classifier.js's scanRedisKeys.
async function scanKeys(redis, pattern) {
  const keys = [];
  let cursor = '0';
  do {
    const result = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = result[0];
    keys.push(...result[1]);
  } while (cursor !== '0');
  return keys;
}

export function requireAdminAuth(req, res, next) {
  const expected = process.env.ADMIN_SECRET_TOKEN;
  if (!expected) {
    return res.status(503).json({ ok: false, error: 'ADMIN_SECRET_TOKEN not configured' });
  }
  // Token sources (P0-6, 2026-09): the x-admin-token header (existing callers)
  // and the standard Authorization: Bearer <token> header. The ?token= query
  // param path was REMOVED — secrets in URLs leak into access logs, proxies and
  // browser history.
  const authHeader = req.headers['authorization'] || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = req.headers['x-admin-token'] || bearer;
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

  // ── Outreach email (Brevo) ────────────────────────────────────────────────
  router.use('/email', emailRouter(express));

  // ── Intelligence ──────────────────────────────────────────────────────────
  router.get('/intel/developers', async (req, res) => {
    try {
      // Pagination guard: developer_intel grows unbounded as the IP classifier
      // runs (24k+ rows / ~10MB if returned whole), which froze the admin
      // dashboard. Default to one page; clamp limit to a sane max.
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
      // Optional ?classification= filter. 'all' (or unset) keeps the default
      // developer+machine lead set; a specific class narrows to it. Value is
      // matched against a fixed allow-list, never interpolated.
      const cls = String(req.query.classification || 'all').toLowerCase();
      const ALLOWED_CLASS = ['developer', 'machine', 'unknown', 'scanner'];
      const clsFilter = ALLOWED_CLASS.includes(cls) ? cls : null;
      // Placeholder index differs per query (list: $3 after limit/offset;
      // count: $1), so build each clause with its own index.
      const listWhere  = clsFilter ? `classification = $3` : `classification IN ('developer','machine')`;
      const countWhere = clsFilter ? `classification = $1` : `classification IN ('developer','machine')`;
      const listParams = clsFilter ? [limit, offset, clsFilter] : [limit, offset];
      const rows = await q(
        `SELECT id, ip, isp, country, classification, score, days_active, calls_today, avg_daily_calls, status, user_agent
           FROM developer_intel
          WHERE ${listWhere}
          ORDER BY score DESC, days_active DESC
          LIMIT $1 OFFSET $2`,
        listParams
      );
      const totalRows = await q(
        `SELECT COUNT(*)::int AS c FROM developer_intel WHERE ${countWhere}`,
        clsFilter ? [clsFilter] : []
      );
      const total = totalRows[0] ? Number(totalRows[0].c) : 0;
      res.json({ ok: true, developers: rows, count: rows.length, total, classification: clsFilter || 'all', limit, offset });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  router.post('/intel/classify', async (req, res) => {
    try {
      const result = await new IpClassifier(pool, redis).run();
      await log('ip-classifier', 'manual trigger', result);
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  router.get('/intel/abuse-overview', async (req, res) => {
    try {
      const summaryRows = await q(
        `SELECT classification, COUNT(*)::int AS count FROM developer_intel GROUP BY classification`
      );
      const allTime = { total_classified: 0, developers: 0, machines: 0, scanners: 0, unknown: 0 };
      for (const row of summaryRows) {
        allTime.total_classified += row.count;
        if (row.classification === 'developer') allTime.developers = row.count;
        else if (row.classification === 'machine') allTime.machines = row.count;
        else if (row.classification === 'scanner') allTime.scanners = row.count;
        else if (row.classification === 'unknown') allTime.unknown = row.count;
      }

      const todayRows = await q(
        `SELECT classification, COUNT(*)::int AS count FROM developer_intel WHERE last_seen > NOW() - INTERVAL '24 hours' GROUP BY classification`
      );
      const activeToday = { total_classified: 0, developers: 0, machines: 0, scanners: 0, unknown: 0 };
      for (const row of todayRows) {
        activeToday.total_classified += row.count;
        if (row.classification === 'developer') activeToday.developers = row.count;
        else if (row.classification === 'machine') activeToday.machines = row.count;
        else if (row.classification === 'scanner') activeToday.scanners = row.count;
        else if (row.classification === 'unknown') activeToday.unknown = row.count;
      }

      const summary = {
        all_time: allTime,
        active_today: activeToday
      };

      const top_abusers = await q(
        `SELECT ip, user_agent, classification, score, calls_today, avg_daily_calls, country, isp
         FROM developer_intel
         WHERE classification != 'developer' AND calls_today > 100
         ORDER BY calls_today DESC LIMIT 20`
      );

      const developer_leads = await q(
        `SELECT ip, user_agent, classification, score, calls_today, avg_daily_calls, country, isp, first_seen
         FROM developer_intel
         WHERE classification = 'developer'
         ORDER BY calls_today DESC LIMIT 20`
      );

      const subnet_hotspots = await q(
        `SELECT
           CONCAT(split_part(ip,'.',1),'.',split_part(ip,'.',2),'.',split_part(ip,'.',3),'.0/24') AS subnet,
           COUNT(DISTINCT ip)::int AS ip_count,
           SUM(calls_today)::int AS total_calls_today
         FROM developer_intel
         WHERE calls_today > 0
         GROUP BY subnet
         ORDER BY total_calls_today DESC
         LIMIT 10`
      );

      // Redis: active UA-cluster blocks (Layer 3) + ASN-blocklist hits (Layer 1)
      // from the free-tier gate. Both are best-effort — Redis errors degrade to
      // empty/zero rather than failing the whole overview.
      let cluster_blocks = [];
      let asn_blocks = 0;
      if (redis) {
        try {
          const clusterKeys = await scanKeys(redis, 'cluster_block:*');
          if (clusterKeys.length) {
            const values = await redis.mget(...clusterKeys);
            const ttls = await Promise.all(clusterKeys.map((k) => redis.ttl(k)));
            cluster_blocks = clusterKeys.map((k, i) => ({
              ua_slug: k.slice('cluster_block:'.length),
              ip_count: parseInt(values[i], 10) || 0,
              ttl_seconds: ttls[i],
            }));
          }
        } catch { /* non-critical */ }

        try {
          const asnKeys = await scanKeys(redis, 'asn:*');
          if (asnKeys.length) {
            const values = await redis.mget(...asnKeys);
            asn_blocks = values.filter((v) => {
              const match = /^AS\d+/.exec(v || '');
              return match && BAD_ASNS.has(match[0]);
            }).length;
          }
        } catch { /* non-critical */ }
      }

      res.json({
        ok: true,
        summary: {
          ...summary,
          blocked_asns: BAD_ASNS.size,
          blocked_clusters: cluster_blocks.length,
        },
        top_abusers,
        developer_leads,
        subnet_hotspots,
        recent_blocks: {
          asn_blocks,
          cluster_blocks,
        },
      });
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
      'pricing-intel': () => evaluatePricing(pool, redis),
    };
    const fn = jobs[req.params.jobId];
    if (!fn) return res.status(404).json({ ok: false, error: `Unknown job: ${req.params.jobId}` });
    try {
      const result = await fn();
      await log(req.params.jobId, 'manual', result);
      res.json({ ok: true, jobId: req.params.jobId, result });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ── Pricing Intelligence (Pricing Command Center) ─────────────────────────
  // The pricing engine is ADVISORY: recommendations are recorded in
  // pricing_decisions; the billed price stays PRICE_PER_CALL_USDT until a
  // human changes it in code. See docs/PRICING_INTELLIGENCE.md.
  router.get('/pricing/command-center', async (req, res) => {
    try {
      const [intel, funnel, decision] = await Promise.all([
        getIntelSummary(pool, redis),
        getConversionFunnel(pool, redis),
        latestDecision(pool),
      ]);
      res.json({
        ok: true,
        data: {
          mode: pricingMode(),
          current_price_usd: PRICE_PER_CALL_USDT,
          current_usd_per_million: PRICE_PER_CALL_USDT * 1_000_000,
          market: {
            median_usd_per_million: intel.market.market_median_usd_per_million,
            average_usd_per_million: intel.market.market_average_usd_per_million,
            position: intel.market.position,
            providers: intel.market.providers,
          },
          machine_preference_score: intel.machine_preference_score,
          price_floor: intel.price_floor,
          conversion_funnel: funnel,
          latest_decision: decision,
          recommended_action: decision
            ? { action: decision.action, recommended_price_usd: decision.recommended_price_usd, reason: decision.reason, decided_at: decision.created_at }
            : { action: 'evaluate', reason: 'no decision recorded yet — POST /admin/pricing/evaluate' },
        },
        ts: Date.now(),
      });
    } catch (e) { res.status(500).json({ ok: false, error: e.message, ts: Date.now() }); }
  });

  // Run a pricing evaluation now (also available as jobs/trigger/pricing-intel).
  router.post('/pricing/evaluate', async (req, res) => {
    try {
      const result = await evaluatePricing(pool, redis);
      await log('pricing-intel', 'manual-evaluate', result);
      res.json({ ok: true, data: result, ts: Date.now() });
    } catch (e) { res.status(500).json({ ok: false, error: e.message, ts: Date.now() }); }
  });

  // Add or update a tracked competitor price point. source_url + confidence
  // are mandatory — unsourced numbers are not accepted into the market model.
  router.post('/pricing/competitor', async (req, res) => {
    try {
      const row = await upsertCompetitorPricePoint(pool, req.body || {});
      await log('pricing-intel', 'competitor-upsert', row);
      res.json({ ok: true, data: row, ts: Date.now() });
    } catch (e) { res.status(400).json({ ok: false, error: e.message, ts: Date.now() }); }
  });

  // Raw market snapshot (same data the public /v1/compare serves).
  router.get('/pricing/market', async (req, res) => {
    try {
      const snapshot = await getMarketSnapshot(pool, PRICE_PER_CALL_USDT);
      res.json({ ok: true, data: snapshot, ts: Date.now() });
    } catch (e) { res.status(500).json({ ok: false, error: e.message, ts: Date.now() }); }
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

  // ════════════════════════════════════════════════════════════════════════
  // OBSERVER ENDPOINTS (Phase 9 — admin dashboard wiring, 2026-06)
  // Read-only KPI surface for the admin control room. Every endpoint returns
  // { ok:true, data:{…}, ts } or { ok:false, error, ts }. All queries are
  // validated against live Railway Postgres. No mocks. Postgres $n params.
  // Known addresses fall back to verified constants when env is unset.
  // ════════════════════════════════════════════════════════════════════════
  const one  = async (sql, params) => (await q(sql, params))[0] || {};
  const num  = (v) => (v === null || v === undefined ? 0 : Number(v));
  const ok   = (res, data) => res.json({ ok: true, data, ts: Date.now() });
  const fail = (res, e) => res.status(500).json({ ok: false, error: e.message, ts: Date.now() });

  // ── Time-window filter (dashboard ?window= param) ─────────────────────────
  // Accepts ?window=1h|24h|7d|30d|custom, defaulting to 24h. For custom, ?from
  // and ?to are ISO-8601 timestamps; invalid custom bounds fall back to 24h.
  // Returns the normalized key plus a Postgres INTERVAL literal (from a fixed
  // allow-list, never interpolated user input) and, for custom, explicit bounds.
  const WINDOW_INTERVALS = { '1h': '1 hour', '24h': '24 hours', '7d': '7 days', '30d': '30 days' };
  const parseWindow = (query) => {
    const raw = String(query.window || '24h').toLowerCase();
    if (raw === 'custom') {
      const from = query.from ? new Date(query.from) : null;
      const to   = query.to   ? new Date(query.to)   : null;
      if (from && !isNaN(from.getTime()) && to && !isNaN(to.getTime())) {
        return { key: 'custom', interval: null, from: from.toISOString(), to: to.toISOString() };
      }
    }
    const key = WINDOW_INTERVALS[raw] ? raw : '24h';
    return { key, interval: WINDOW_INTERVALS[key], from: null, to: null };
  };
  // Build a windowed WHERE predicate + params for a timestamp column expression.
  // `col` is a SQL expression yielding timestamptz (e.g. 'last_seen' or
  // 'to_timestamp(created_at)'); `startIdx` is the first $n placeholder to use.
  // The INTERVAL literal is safe — it comes only from WINDOW_INTERVALS above.
  const windowPredicate = (win, col, startIdx = 1) => {
    if (win.key === 'custom') {
      return { clause: `${col} >= $${startIdx} AND ${col} <= $${startIdx + 1}`, params: [win.from, win.to] };
    }
    return { clause: `${col} > NOW() - INTERVAL '${win.interval}'`, params: [] };
  };

  const VAULT_ADDRESS    = process.env.REVENUE_VAULT || '0x577D3716d6Ad5b676d230f5409deF9838FABaCEF';
  const USDT_ADDRESS     = process.env.USDT_ADDRESS  || '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
  const TREASURY_FALLBACK = '0x966E1Ae22996545015b1414B35234b10719d7Ad4';
  const BILLING_RATE     = parseFloat(process.env.PRICE_PER_CALL || '0.00003');

  // Traffic truth source (audit 2026-07-06, docs/DATA_TRUTH_AUDIT.md #2/#3):
  // developer_intel.calls_today is only overwritten when an IP reappears in the
  // Redis counters, so SUM(calls_today) over the whole table double-counts every
  // IP that went quiet (81% of the sum at audit time). The live counters are the
  // Redis ft:* keys (reset at UTC midnight); the DB fallback filters on last_seen.
  const trafficToday = async () => {
    if (redis) {
      try {
        const keys = await scanKeys(redis, 'ft:*');
        const ipKeys = keys.filter((k) => !k.startsWith('ftua:'));
        let calls = 0;
        if (ipKeys.length) {
          const vals = await redis.mget(...ipKeys);
          for (const v of vals) calls += parseInt(v, 10) || 0;
        }
        return { requests: calls, active_ips: ipKeys.length, source: 'redis_utc_day' };
      } catch { /* fall through to DB */ }
    }
    const r = await one(
      `SELECT COUNT(*) FILTER (WHERE calls_today > 0)::int AS ips,
              COALESCE(SUM(calls_today) FILTER (WHERE calls_today > 0),0)::int AS calls
         FROM developer_intel WHERE last_seen >= now() - interval '24 hours'`);
    return { requests: num(r.calls), active_ips: num(r.ips), source: 'developer_intel_last_seen_24h' };
  };

  // Revenue split: internal = usage metered against API keys owned by the
  // treasury wallet itself (self-usage is not customer revenue).
  const REVENUE_SPLIT_SQL = `
    SELECT
      COALESCE(SUM(e.amount_usdt),0)::float AS lifetime,
      COALESCE(SUM(e.amount_usdt) FILTER (WHERE t.api_key IS NOT NULL),0)::float AS internal,
      COALESCE(SUM(e.amount_usdt) FILTER (WHERE t.api_key IS NULL),0)::float    AS external,
      COALESCE(SUM(e.amount_usdt) FILTER (WHERE to_timestamp(e.created_at) >= date_trunc('day', now())),0)::float AS today
    FROM revenue_events_v2 e
    LEFT JOIN api_credits t
      ON t.api_key = e.client_id AND lower(t.wallet_address) = lower($1)
    WHERE NOT e.is_test_data`;

  // OBSERVER — Executive Summary (CEO screen, single call)
  router.get('/executive/summary', async (req, res) => {
    try {
      const win = parseWindow(req.query);
      const treasuryAddr = process.env.TREASURY_ADDRESS || TREASURY_FALLBACK;
      const rev = await one(REVENUE_SPLIT_SQL, [treasuryAddr]);
      // Real revenue inside the requested ?window= (default 24h). created_at is
      // epoch SECONDS, so compare via to_timestamp(); test rows always excluded.
      const wpRev = windowPredicate(win, 'to_timestamp(created_at)', 1);
      const revWin = await one(
        `SELECT COALESCE(SUM(amount_usdt),0)::float AS s, COUNT(*)::int AS c
           FROM revenue_events_v2 WHERE NOT is_test_data AND ${wpRev.clause}`, wpRev.params);
      // Active IPs seen inside the window (last_seen), so the KPI tracks ?window=.
      const wpIps = windowPredicate(win, 'last_seen', 1);
      const ipsWin = await one(`SELECT COUNT(*)::int AS c FROM developer_intel WHERE ${wpIps.clause}`, wpIps.params);
      const traffic = await trafficToday();
      const paying = await one(`SELECT COUNT(DISTINCT api_key)::int AS c FROM api_deposits`);
      const health = await one(
        `SELECT ROUND(100.0*COUNT(*) FILTER (WHERE status IN ('healthy','ok','up','online'))/NULLIF(COUNT(*),0),2)::float AS pct,
                COUNT(DISTINCT node_id)::int AS nodes
         FROM node_health_logs WHERE checked_at >= extract(epoch from now())-86400`);
      const alerts = await one(`SELECT COUNT(*) FILTER (WHERE alerted_at >= now()-interval '24 hours')::int AS c FROM gas_alerts`);
      const settle = await new SettlementControl(pool).getStatus();
      const blocked = await one(`SELECT COUNT(*)::int AS c FROM settlement_batches WHERE status='blocked_unfunded'`);

      const top_risks = [];
      if (settle.dryRun)                  top_risks.push({ code: 'SETTLEMENT_DRY_RUN', label: 'Settlement in DRY_RUN — no on-chain broadcast', severity: 'high', unblock: 'Clears at real external metered revenue > $0.50 + funded signer + human decision' });
      if (settle.signerBalance === null || Number(settle.signerBalance) === 0)
                                          top_risks.push({ code: 'SIGNER_UNFUNDED', label: 'Signer balance unreadable / unfunded', severity: 'high', unblock: `Fund signer ${settle.signerAddress || ''} with POL for gas` });
      if (num(blocked.c) > 0)             top_risks.push({ code: 'BLOCKED_BATCHES', label: `${num(blocked.c)} blocked_unfunded settlement batches`, severity: 'high', unblock: 'Fund the settlement signer to release blocked batches' });
      if (num(rev.external) < 0.5)        top_risks.push({ code: 'REVENUE_ANCHOR', label: 'Real external revenue below $0.50 anchor threshold', severity: 'medium', unblock: 'Convert free-tier traffic to metered deposits' });

      // Health score = f(node availability, settlement state, funding state) —
      // not the raw single-node heartbeat, which reads a vacuous 100%
      // (audit #5). Components are returned so the UI can show the formula.
      const nodeAvail = health.pct === null || health.pct === undefined ? 0 : num(health.pct);
      const signerUnfunded = settle.signerBalance === null || Number(settle.signerBalance) === 0;
      const penalties = {
        signer_unfunded: signerUnfunded ? -30 : 0,
        blocked_batches: num(blocked.c) > 0 ? -20 : 0,
        dry_run: settle.dryRun ? -10 : 0,
      };
      const healthScore = Math.max(0, Math.round(
        nodeAvail + penalties.signer_unfunded + penalties.blocked_batches + penalties.dry_run));

      ok(res, {
        window: win.key,
        window_from: win.from,
        window_to: win.to,
        // Real (non-test) revenue and event count inside the selected window.
        revenue_window_usdt: num(revWin.s),
        revenue_window_events: num(revWin.c),
        active_ips_window: num(ipsWin.c),
        revenue_today_usdt: num(rev.today),
        // Kept for dashboard compatibility; this has always been the lifetime
        // real (non-test) sum, now split into external vs internal below.
        revenue_mtd_usdt: num(rev.lifetime),
        revenue_lifetime_usdt: num(rev.lifetime),
        revenue_external_usdt: num(rev.external),
        revenue_internal_usdt: num(rev.internal),
        revenue_label: 'Lifetime',
        active_ips_24h: traffic.active_ips,
        total_requests_24h: traffic.requests,
        requests_source: traffic.source,
        requests_window: traffic.source === 'redis_utc_day' ? 'since UTC midnight' : 'last 24 hours',
        paying_customers: num(paying.c),
        paying_customers_external: num(paying.c),
        paying_customers_internal: 0,
        settlement_mode: settle.dryRun ? 'DRY_RUN' : 'LIVE',
        signer_balance_pol: settle.signerBalance,
        network_health_pct: healthScore,
        health_components: {
          node_availability_pct: nodeAvail,
          node_sample_count: num(health.nodes),
          ...penalties,
        },
        open_alerts: num(alerts.c),
        top_risks,
      });
    } catch (e) { fail(res, e); }
  });

  // OBSERVER — Revenue Summary
  router.get('/revenue/summary', async (req, res) => {
    try {
      const r = await one(
        `SELECT
           COALESCE(SUM(amount_usdt) FILTER (WHERE NOT is_test_data AND to_timestamp(created_at) >= date_trunc('day', now())),0)::float   AS today,
           COALESCE(SUM(amount_usdt) FILTER (WHERE NOT is_test_data AND to_timestamp(created_at) >= date_trunc('month', now())),0)::float AS mtd,
           COALESCE(SUM(amount_usdt) FILTER (WHERE NOT is_test_data),0)::float AS total_real,
           COUNT(*)::int                                AS events_count,
           COUNT(*) FILTER (WHERE is_test_data)::int    AS test_count,
           COUNT(*) FILTER (WHERE NOT is_test_data)::int AS real_count
         FROM revenue_events_v2`);
      const split = await one(REVENUE_SPLIT_SQL, [process.env.TREASURY_ADDRESS || TREASURY_FALLBACK]);
      const traffic = await trafficToday();
      ok(res, {
        today_usdt: num(r.today),
        mtd_usdt: num(r.mtd),
        total_real_usdt: num(r.total_real),
        external_usdt: num(split.external),
        internal_usdt: num(split.internal),
        events_count: num(r.events_count),
        is_test_data_count: num(r.test_count),
        real_data_count: num(r.real_count),
        billing_rate: BILLING_RATE,
        free_tier_calls_24h: traffic.requests,
        requests_source: traffic.source,
      });
    } catch (e) { fail(res, e); }
  });

  // OBSERVER — Revenue Events (paginated, newest first)
  router.get('/revenue/events', async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const offset = parseInt(req.query.offset, 10) || 0;
      const rows = await q(
        `SELECT id, op_type, node_id, client_id, amount_usdt::float AS amount_usdt, status, chain, method,
                source, epoch_id, is_test_data, created_at,
                to_timestamp(created_at) AS created_ts
         FROM revenue_events_v2 ORDER BY created_at DESC NULLS LAST LIMIT $1 OFFSET $2`, [limit, offset]);
      ok(res, { events: rows, count: rows.length, limit, offset });
    } catch (e) { fail(res, e); }
  });

  // OBSERVER — Revenue Funnel (request → billed → settled → withdrawable)
  router.get('/revenue/funnel', async (req, res) => {
    try {
      const traffic = await trafficToday();
      const ev = await one(`SELECT COUNT(*) FILTER (WHERE to_timestamp(created_at) >= now()-interval '24 hours')::int AS c FROM revenue_events_v2 WHERE NOT is_test_data`);
      const spent = await one(`SELECT COALESCE(SUM(total_spent),0)::float AS c FROM api_credits`);
      const settled = await one(`SELECT COALESCE(SUM(total_amount_usdt) FILTER (WHERE status='confirmed'),0)::float AS c FROM settlement_batches`);
      const treas = await one(`SELECT COALESCE(SUM(total_to_claims_usdt),0)::float AS c FROM treasury_state`);
      ok(res, {
        requests_24h: traffic.requests,
        requests_source: traffic.source,
        billable_24h: num(ev.c),
        revenue_events_24h: num(ev.c),
        credits_consumed_usdt: num(spent.c),
        settled_usdt: num(settled.c),
        withdrawable_usdt: num(treas.c),
      });
    } catch (e) { fail(res, e); }
  });

  // OBSERVER — Demand Leads (ALIAS of /intel/developers for dashboard compatibility)
  router.get('/demand/leads', async (req, res) => {
    try {
      // Same pagination guard as /intel/developers (this is an alias of it).
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
      const rows = await q(
        `SELECT id, ip, isp, country, classification, score, days_active, calls_today, avg_daily_calls, status, user_agent
           FROM developer_intel
          WHERE classification IN ('developer','machine')
          ORDER BY score DESC, days_active DESC
          LIMIT $1 OFFSET $2`,
        [limit, offset]);
      const total = num((await one(
        `SELECT COUNT(*)::int AS c FROM developer_intel WHERE classification IN ('developer','machine')`)).c);
      ok(res, { developers: rows, leads: rows, count: rows.length, total, limit, offset });
    } catch (e) { fail(res, e); }
  });

  // OBSERVER — Demand Stats
  router.get('/demand/stats', async (req, res) => {
    try {
      const win = parseWindow(req.query);
      const allTimeRows = await q(`SELECT classification, COUNT(*)::int AS c FROM developer_intel GROUP BY classification`);
      const allTime = Object.fromEntries(allTimeRows.map(r => [r.classification || 'unknown', r.c]));
      // active_today reflects the requested ?window= (default 24h): IPs whose
      // last_seen falls inside the window, grouped by classification.
      const wp = windowPredicate(win, 'last_seen', 1);
      const todayRows = await q(`SELECT classification, COUNT(*)::int AS c FROM developer_intel WHERE ${wp.clause} GROUP BY classification`, wp.params);
      const today = Object.fromEntries(todayRows.map(r => [r.classification || 'unknown', r.c]));
      const total = await one(`SELECT COUNT(*)::int AS c FROM developer_intel`);
      const traffic = await trafficToday();
      // Top lead restricted to IPs actually seen in the window — a stale
      // calls_today from a long-gone IP is not a lead (audit #15).
      const wpTop = windowPredicate(win, 'last_seen', 1);
      const top = await one(
        `SELECT ip, calls_today FROM developer_intel
          WHERE ${wpTop.clause}
          ORDER BY calls_today DESC NULLS LAST LIMIT 1`, wpTop.params);
      const activeCounts = {
        machine: num(today.machine),
        developer: num(today.developer),
        unknown: num(today.unknown),
        scanner: num(today.scanner),
      };
      // Active IP total for the window = sum of the per-class active counts, so
      // it tracks the same ?window= as active_today (traffic.active_ips is a
      // fixed UTC-day Redis figure and only valid for the default 24h view).
      const activeIpsWindow = win.key === '24h'
        ? traffic.active_ips
        : activeCounts.machine + activeCounts.developer + activeCounts.unknown + activeCounts.scanner;
      ok(res, {
        window: win.key,
        window_from: win.from,
        window_to: win.to,
        all_time: {
          machine: num(allTime.machine),
          developer: num(allTime.developer),
          unknown: num(allTime.unknown),
          scanner: num(allTime.scanner),
        },
        // Kept as `active_today` for dashboard compatibility; now windowed.
        active_today: activeCounts,
        total_active_ips: activeIpsWindow,
        total_tracked_ips: num(total.c),
        requests_source: traffic.source,
        top_lead_ip: top.ip || null,
        top_lead_calls_per_day: num(top.calls_today),
      });
    } catch (e) { fail(res, e); }
  });

  // OBSERVER — Network Health
  router.get('/network/health', async (req, res) => {
    try {
      const h = await one(
        `SELECT
           ROUND(100.0*COUNT(*) FILTER (WHERE status IN ('healthy','ok','up','online'))/NULLIF(COUNT(*),0),2)::float AS avail,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY response_time_ms)::float AS p50,
           ROUND(100.0*COUNT(*) FILTER (WHERE status NOT IN ('healthy','ok','up','online'))/NULLIF(COUNT(*),0),2)::float AS err
         FROM node_health_logs WHERE checked_at >= extract(epoch from now())-86400`);
      const traffic = await trafficToday();
      const nodes = await one(`SELECT COUNT(*) FILTER (WHERE status='active')::int AS c FROM registered_nodes`);
      const sample = await one(
        `SELECT COUNT(DISTINCT node_id)::int AS nodes FROM node_health_logs
          WHERE checked_at >= extract(epoch from now())-86400`);
      const chains = await q(
        `SELECT DISTINCT jsonb_array_elements_text(chain_ids) AS chain_id FROM registered_nodes WHERE status='active'`);
      const chainNames = { '137': 'Polygon', '1': 'Ethereum', '80002': 'Polygon Amoy' };
      ok(res, {
        availability_pct: num(h.avail),
        // Availability/p50 describe the health-log sample, which today is a
        // single self-heartbeat node — the UI must label the sample size
        // (audit #17), so it is included here.
        availability_sample_nodes: num(sample.nodes),
        p50_latency_ms: num(h.p50),
        error_rate_pct: num(h.err),
        requests_24h: traffic.requests,
        requests_source: traffic.source,
        active_nodes: num(nodes.c),
        chain_status: chains.map(c => ({
          chain_id: parseInt(c.chain_id, 10),
          name: chainNames[c.chain_id] || `chain-${c.chain_id}`,
          status: num(nodes.c) > 0 ? 'operational' : 'degraded',
          requests_24h: traffic.requests,
        })),
      });
    } catch (e) { fail(res, e); }
  });

  // OBSERVER — Nodes List
  router.get('/nodes/list', async (req, res) => {
    try {
      const nodes = await q(
        `SELECT node_id AS id, region, uptime_pct::float AS uptime_pct, reputation_score,
                total_requests_served AS jobs_executed, avg_latency_ms, tier, status
         FROM registered_nodes ORDER BY reputation_score DESC, total_requests_served DESC`);
      ok(res, {
        nodes: nodes.map(n => ({ ...n, revenue_usdt: 0 })),
        total_active: nodes.filter(n => n.status === 'active').length,
        total_offline: nodes.filter(n => n.status !== 'active').length,
      });
    } catch (e) { fail(res, e); }
  });

  // OBSERVER — Billing / Credits
  router.get('/billing/credits', async (req, res) => {
    try {
      const c = await one(
        `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE tier='free')::int AS free,
                COUNT(*) FILTER (WHERE tier<>'free')::int AS paid,
                COALESCE(SUM(total_deposited),0)::float AS deposited,
                COALESCE(SUM(total_spent),0)::float    AS spent,
                COALESCE(SUM(credits_usdt),0)::float   AS outstanding
         FROM api_credits`);
      const deposits = await q(
        `SELECT wallet_address, amount_usdt::float AS amount_usdt, tx_hash, chain_id, confirmed_at
         FROM credit_deposits ORDER BY confirmed_at DESC LIMIT 10`);
      ok(res, {
        total_keys: num(c.total),
        free_keys: num(c.free),
        paid_keys: num(c.paid),
        total_deposited_usdt: num(c.deposited),
        total_spent_usdt: num(c.spent),
        total_outstanding_usdt: num(c.outstanding),
        deposits,
      });
    } catch (e) { fail(res, e); }
  });

  // OBSERVER — Treasury Status (enriched settlement view)
  router.get('/treasury/status', async (req, res) => {
    try {
      const settle = await new SettlementControl(pool).getStatus();
      const rows = await q(`SELECT status, COUNT(*)::int AS c, COALESCE(SUM(total_amount_usdt),0)::float AS usdt FROM settlement_batches GROUP BY status`);
      const by = Object.fromEntries(rows.map(r => [r.status, r]));
      const minAnchor = parseFloat(process.env.MIN_ANCHOR_REVENUE_USDT || '0.5');
      const confirmedUsdt = num(by.confirmed?.usdt);
      ok(res, {
        dry_run: !!settle.dryRun,
        signer_balance_pol: settle.signerBalance,
        signer_address: settle.signerAddress,
        vault_address: VAULT_ADDRESS,
        usdt_address: USDT_ADDRESS,
        treasury_address: settle.treasuryAddress || TREASURY_FALLBACK,
        pending_batches: num(by.pending?.c),
        blocked_unfunded_batches: num(by.blocked_unfunded?.c),
        confirmed_batches: num(by.confirmed?.c),
        confirmed_usdt: confirmedUsdt,
        blocked_unfunded_usdt: num(by.blocked_unfunded?.usdt),
        min_anchor_usdt: minAnchor,
        threshold_met: confirmedUsdt >= minAnchor,
      });
    } catch (e) { fail(res, e); }
  });

  // OBSERVER — Customers List
  router.get('/customers/list', async (req, res) => {
    try {
      const paying = await q(
        `SELECT wallet_address AS wallet, credits_usdt::float AS credits_usdt,
                total_deposited::float AS total_deposited, total_spent::float AS total_spent, created_at
         FROM api_credits WHERE total_deposited > 0 ORDER BY total_deposited DESC`);
      // Conversion pipeline: active free-tier machines with the fields the
      // Customer Ops table needs — first seen, last call, and whether the
      // lead converted (stage advanced to deposited/paid). last_seen filter
      // keeps stale calls_today counters out (audit #2).
      const free_tier = await q(
        `SELECT ip, calls_today AS calls_24h, first_seen, last_seen,
                classification, status,
                (status IN ('deposited','paid')) AS converted
           FROM developer_intel
          WHERE calls_today > 0 AND last_seen >= now() - interval '24 hours'
          ORDER BY calls_today DESC LIMIT 50`);
      ok(res, { paying, free_tier, total_paying: paying.length });
    } catch (e) { fail(res, e); }
  });

  // OBSERVER — Agents Status (Satelink_Paperclip service is FAILED — honest report)
  router.get('/agents/status', async (req, res) => {
    ok(res, {
      agents_service: 'FAILED',
      url: 'agents.satelink.network',
      agents: [],
      note: 'Satelink_Paperclip service is offline — restart required in Railway dashboard. Endpoint reports Railway service status; it does not call the down service.',
    });
  });

  // OBSERVER — Security: classifier stats
  router.get('/security/classifier-stats', async (req, res) => {
    try {
      const allTimeRows = await q(`SELECT classification, COUNT(*)::int AS c FROM developer_intel GROUP BY classification`);
      const allTime = Object.fromEntries(allTimeRows.map(r => [r.classification || 'unknown', r.c]));
      const todayRows = await q(`SELECT classification, COUNT(*)::int AS c FROM developer_intel WHERE last_seen > NOW() - INTERVAL '24 hours' GROUP BY classification`);
      const today = Object.fromEntries(todayRows.map(r => [r.classification || 'unknown', r.c]));
      const total = allTimeRows.reduce((s, r) => s + r.c, 0);
      ok(res, {
        all_time: {
          machine: num(allTime.machine),
          developer: num(allTime.developer),
          unknown: num(allTime.unknown),
          scanner: num(allTime.scanner),
        },
        active_today: {
          machine: num(today.machine),
          developer: num(today.developer),
          unknown: num(today.unknown),
          scanner: num(today.scanner),
        },
        total,
      });
    } catch (e) { fail(res, e); }
  });

  // OBSERVER — Security: threats (derived from developer_intel — no dedicated threats table)
  router.get('/security/threats', async (req, res) => {
    try {
      const rows = await q(
        `SELECT ip, user_agent, classification, score, calls_today, avg_daily_calls, country, isp, asn, last_seen
         FROM developer_intel
         WHERE classification IN ('scanner','unknown') OR calls_today > 1000
         ORDER BY calls_today DESC NULLS LAST LIMIT 50`);
      ok(res, { threats: rows, count: rows.length, source: 'developer_intel (no dedicated threats table)' });
    } catch (e) { fail(res, e); }
  });

  // OBSERVER — Observability metrics (server-internal)
  router.get('/observability/metrics', async (req, res) => {
    try {
      const mem = process.memoryUsage();
      const cpu = process.cpuUsage();
      let db_status = 'error';
      try { await pool.query('SELECT 1'); db_status = 'ok'; } catch { db_status = 'error'; }
      let redis_status = 'not_configured';
      if (redis) { try { await redis.ping(); redis_status = 'ok'; } catch { redis_status = 'error'; } }
      const lat = await one(
        `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY response_time_ms)::float AS p50
         FROM node_health_logs WHERE checked_at >= extract(epoch from now())-86400`);
      const calls = await one(`SELECT COALESCE(SUM(calls_today),0)::int AS c FROM developer_intel`);
      ok(res, {
        cpu_pct: Math.round(((cpu.user + cpu.system) / 1e6 / Math.max(process.uptime(), 1)) * 100) / 100,
        memory_mb: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
        uptime_s: Math.round(process.uptime()),
        db_status,
        redis_status,
        api_p50_ms: num(lat.p50),
        requests_24h: num(calls.c),
      });
    } catch (e) { fail(res, e); }
  });

  // OBSERVER — Incidents (STATIC historical record until an incidents table exists)
  router.get('/incidents', async (req, res) => {
    ok(res, {
      incidents: [
        { id: 'INC-013', severity: 'critical', title: 'Signer drain — 1,878 phantom settlement TX', status: 'resolved', owner: 'platform', resolved_at: null, note: 'Historical fact. Must never appear as a fabricated live UI metric.' },
        { id: 'INC-014', severity: 'high',     title: 'Phantom billing — test revenue counted as real',        status: 'resolved', owner: 'platform', resolved_at: null, note: 'Fixed by is_test_data filtering + phantom-epoch exclusion.' },
        { id: 'INC-012', severity: 'high',     title: 'Redis OOM',                                              status: 'resolved', owner: 'platform', resolved_at: null },
      ],
      source: 'STATIC — no incidents table yet (migration required to make this live)',
    });
  });

  // OBSERVER — Audit Log
  router.get('/audit-log', async (req, res) => {
    try {
      const exists = await one(`SELECT to_regclass('public.admin_audit_log') AS t`);
      if (!exists.t) {
        return res.json({ ok: true, data: [], note: 'admin_audit_log table not yet created — migration required', ts: Date.now() });
      }
      const rows = await q(`SELECT * FROM admin_audit_log ORDER BY created_at DESC LIMIT 100`);
      ok(res, rows);
    } catch (e) { fail(res, e); }
  });

  // OBSERVER — Config (key names + sanitized values only — NEVER secret values)
  router.get('/config', async (req, res) => {
    ok(res, {
      PRICE_PER_CALL: String(BILLING_RATE),
      FREE_TIER_LIMIT: process.env.FREE_TIER_LIMIT || '500',
      SETTLEMENT_DRY_RUN: process.env.SETTLEMENT_DRY_RUN || '1',
      MIN_ANCHOR_REVENUE_USDT: process.env.MIN_ANCHOR_REVENUE_USDT || '0.5',
      CHAIN_ID: '137',
      REVENUE_VAULT: VAULT_ADDRESS,
      USDT_ADDRESS,
      BREVO_CONFIGURED: process.env.BREVO_API_KEY ? 'true' : 'false',
      ADMIN_TOKEN_CONFIGURED: process.env.ADMIN_SECRET_TOKEN ? 'true' : 'false',
      NOTE: 'Secret values are never returned. Keys only.',
    });
  });

  return router;
}

export default createAdminRouter;
