/**
 * IP Classifier — Satelink Admin
 * Reads REAL free-tier IP counters from Redis and classifies them as
 * scanner / machine / developer / unknown (priority order). Persists to developer_intel.
 * Classification gates developer on BEHAVIOR (low volume + multi-day tenure), not UA
 * alone, so high-volume bots using dev-style UAs are demoted to machine/scanner.
 *
 * Built against the actual repo (corrected vs the original design doc):
 *   - Redis key prefix is `ft:<ip>` (see free_tier_gate.js:85), NOT `free_tier:`
 *   - `pool` is a pg Pool: pool.query() returns { rows } — not a bare array
 *   - SCAN (cursor), never KEYS — safe at any scale
 *   - IP lookups cached in Redis (7-day TTL), in-process rate limiter for ip-api.com
 *   - No seeded/fabricated data: every row reflects an IP actually observed in Redis
 *
 * NOTE: the audit (docs/audit-2026-06-13/LEAD_QUALITY_REPORT.md) found this
 * traffic is dominated by scanner-class clients, not developer demand. The
 * `classification`/`score` here are heuristics over observed counters, not a
 * claim of real revenue intent. Read them as such.
 */

// In-process rate limiter for ip-api.com (free tier: 45 req/min)
const ipApiLimiter = {
  calls: 0,
  resetAt: Date.now() + 60000,
  canCall() {
    const now = Date.now();
    if (now > this.resetAt) {
      this.calls = 0;
      this.resetAt = now + 60000;
    }
    return this.calls < 40; // conservative buffer under the 45/min cap
  },
  increment() { this.calls++; },
};

// UA signal sets, shared by classify() and computeScore() so the two never drift.
// WEB3_UA_SIGNALS — strong intent (blockchain dev tooling). GENERIC_DEV_UA_SIGNALS —
// HTTP-client UAs that only count as a developer when paired with human-like behavior
// (low volume, multi-day). Substring match, lowercased — mirrors the existing logic.
const WEB3_UA_SIGNALS = [
  'web3.py', 'ethers', 'viem', 'web3.js', 'erpc',
  'wagmi', 'cast', 'foundry', 'hardhat', 'brownie', 'anchor',
];
const GENERIC_DEV_UA_SIGNALS = [
  'python-requests', 'aiohttp', 'axios', 'httpx', 'bun/', 'okhttp', 'go-http-client',
];
const SCANNER_UA_SIGNALS = [
  'masscan', 'zgrab', 'shodan', 'scanner', 'rpc-health', 'health-check',
];

export class IpClassifier {
  constructor(pool, redis) {
    this.pool = pool;
    this.redis = redis;
  }

  async q(sql, params) {
    const r = await this.pool.query(sql, params);
    return r.rows;
  }

  // SAFE Redis scan — uses SCAN cursor, never KEYS
  async scanRedisKeys(pattern) {
    const keys = [];
    let cursor = '0';
    do {
      const result = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = result[0];
      keys.push(...result[1]);
    } while (cursor !== '0');
    return keys;
  }

  // Cached IP lookup — Redis TTL 7 days, rate-limited graceful fallback
  async lookupIP(ip) {
    const cacheKey = `ip_info:${ip}`;

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch { /* cache miss, continue */ }

    if (!ipApiLimiter.canCall()) {
      console.warn(`[IpClassifier] ip-api.com rate limit reached; returning unknown for ${ip}`);
      return { isp: 'unknown', country: 'unknown', city: 'unknown', asn: '', ua: '' };
    }

    try {
      ipApiLimiter.increment();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const r = await fetch(`http://ip-api.com/json/${ip}?fields=isp,country,city,as`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!r.ok) throw new Error(`ip-api status ${r.status}`);
      const d = await r.json();
      const info = {
        isp: d.isp || 'unknown',
        country: d.country || 'unknown',
        city: d.city || 'unknown',
        asn: d.as || '',
        ua: '',
      };
      await this.redis.setex(cacheKey, 604800, JSON.stringify(info));
      // Feeds free_tier_gate.js's bad-ASN blocklist (Layer 1) — 7d TTL matches
      // the ip_info: cache above so both expire together.
      try {
        if (info.asn) {
          await this.redis.set(`asn:${ip}`, info.asn, 'EX', 604800);
        }
      } catch (_) { /* non-critical */ }
      return info;
    } catch (e) {
      console.warn(`[IpClassifier] ip-api.com lookup failed for ${ip}: ${e.message}`);
      return { isp: 'unknown', country: 'unknown', city: 'unknown', asn: '', ua: '' };
    }
  }

  computeScore(dev) {
    let score = 0;
    const ua = (dev.user_agent || '').toLowerCase();
    const daysActive = dev.days_active || 0;
    const avg = dev.avg_daily_calls || 0;
    const callsToday = dev.calls_today || 0;

    // Tenure: returning over many days is the strongest human signal.
    if (daysActive >= 7)      score += 20;
    else if (daysActive >= 3) score += 10;
    else if (daysActive === 1) score -= 10; // single-day-only looks like a one-shot bot

    // Volume sweet spot vs. bot-grade firehose.
    if (avg >= 100 && avg <= 500) score += 15;
    if (avg > 2000)               score -= 30;

    // UA intent. web3-specific tooling outweighs a generic HTTP client.
    if (WEB3_UA_SIGNALS.some((s) => ua.includes(s)))            score += 25;
    else if (GENERIC_DEV_UA_SIGNALS.some((s) => ua.includes(s))) score += 8;

    if (callsToday > 1000) score -= 20; // hammering today

    return Math.max(0, Math.min(100, score));
  }

  // Priority-ordered: scanner → machine → developer → unknown. Volume gates run
  // BEFORE UA-based developer tagging so a high-volume bot using a dev-style UA
  // (python-requests, axios, …) is demoted to machine/scanner instead of counting
  // as a lead. `calls` is calls_today; daysActive/avgDailyCalls default for new IPs.
  classify(info, calls, daysActive = 1, avgDailyCalls = 0) {
    const ua = (info.ua || '').toLowerCase();
    const callsToday = calls || 0;
    const days = daysActive || 1;
    const avg = avgDailyCalls || 0;

    // ── SCANNER (highest priority) ──
    if (callsToday > 5000) return 'scanner';                 // firehose, any UA
    if (SCANNER_UA_SIGNALS.some((s) => ua.includes(s))) return 'scanner';

    // ── MACHINE ──
    if (callsToday > 1000 && days === 1) return 'machine';   // one-shot scraper
    if (callsToday > 500 && days <= 2)   return 'machine';   // bot farm
    if (callsToday > 200 && avg > 2000)  return 'machine';   // high-volume machine
    if (!ua)                             return 'machine';   // no UA at all

    // ── DEVELOPER (must pass ALL conditions for its branch) ──
    if (WEB3_UA_SIGNALS.some((s) => ua.includes(s)) &&
        callsToday < 2000 &&
        (days >= 2 || (avg >= 50 && avg <= 1000))) {
      return 'developer';
    }
    if (GENERIC_DEV_UA_SIGNALS.some((s) => ua.includes(s)) &&
        callsToday < 600 &&        // under free tier × 1.2 — not hammering
        days >= 2) {               // came back a second day (human behavior)
      return 'developer';
    }

    // ── UNKNOWN (default) ──
    return 'unknown';
  }

  async run() {
    const results = { classified: 0, developers: 0, crawlers: 0, newIPs: 0, errors: 0 };

    // Real free-tier counters live under `ft:<ip>` (free_tier_gate.js:85)
    const keys = await this.scanRedisKeys('ft:*');
    console.log(`[IpClassifier] Found ${keys.length} IPs via SCAN (ft:*)`);

    for (const key of keys) {
      try {
        const ip = key.slice(3); // strip 'ft:'
        const calls = parseInt(await this.redis.get(key) || '0');

        // ip-api.com (lookupIP) is a geo lookup, not a UA source — the real UA is
        // written by free_tier_gate.js to `ftua:<ip>` with the same daily TTL as `ft:<ip>`.
        let userAgent = '';
        try {
          userAgent = await this.redis.get(`ftua:${ip}`) || '';
        } catch { /* non-critical */ }

        // Ground-truth first-seen timestamp, written at request time by
        // free_tier_gate.js (`fs:<ip>`, NX). Used for accurate first_seen/days_active
        // instead of the classifier's own run time.
        let realFirstSeen = null;
        try {
          const fsTs = await this.redis.get(`fs:${ip}`);
          if (fsTs) realFirstSeen = new Date(parseInt(fsTs));
        } catch { /* non-critical */ }

        const rows = await this.q(
          `SELECT id, days_active, avg_daily_calls, calls_today, updated_at FROM developer_intel WHERE ip = $1`,
          [ip]
        );

        if (rows.length > 0) {
          const existing = rows[0];

          // Backfill first_seen if Redis has an earlier ground-truth timestamp
          // than what's currently stored (e.g. row was created before fs:<ip> existed).
          if (realFirstSeen) {
            await this.q(
              `UPDATE developer_intel SET first_seen = LEAST(first_seen, $1) WHERE ip = $2 AND first_seen > $1`,
              [realFirstSeen, ip]
            );
          }

          const today = new Date().toISOString().slice(0, 10);
          const lastSeenDay = existing.updated_at
            ? new Date(existing.updated_at).toISOString().slice(0, 10)
            : null;

          if (lastSeenDay === today) {
            // Same UTC day as last update — just refresh the live counter.
            // Do NOT touch avg_daily_calls; it must stay stable intraday so the
            // value never chases the monotonically-climbing ft:<ip> counter.
            await this.q(
              `UPDATE developer_intel SET calls_today = $1, user_agent = $2, last_seen = NOW(), updated_at = NOW() WHERE ip = $3`,
              [calls, userAgent, ip]
            );
          } else {
            // New UTC day — fold YESTERDAY's final calls_today into a proper running
            // mean, weighted by days_active so one new day doesn't overweight a long
            // history. `calls` here is the fresh (small) counter for the new day and is
            // only used as the new calls_today, NOT folded into newAvg.
            const priorCallsToday = existing.calls_today || 0;
            const priorDaysActive = existing.days_active || 1;
            const newAvg = Math.round(
              ((existing.avg_daily_calls || 0) * priorDaysActive + priorCallsToday)
              / (priorDaysActive + 1)
            );
            await this.q(
              `UPDATE developer_intel SET avg_daily_calls = $1, calls_today = $2, user_agent = $3, days_active = days_active + 1, last_seen = NOW(), updated_at = NOW() WHERE ip = $4`,
              [newAvg, calls, userAgent, ip]
            );
          }
        } else {
          const info = await this.lookupIP(ip);
          // Real days_active from the ground-truth first_seen, not a hardcoded 1.
          const daysActive = realFirstSeen
            ? Math.max(1, Math.floor((Date.now() - realFirstSeen.getTime()) / 86400000))
            : 1;
          // New IP: avg_daily_calls is seeded to today's counter (see VALUES $9,$9).
          const classification = this.classify({ ua: userAgent }, calls, daysActive, calls);
          const score = this.computeScore({ user_agent: userAgent, days_active: daysActive, avg_daily_calls: calls, calls_today: calls });

          await this.q(
            `INSERT INTO developer_intel
               (ip, asn, isp, country, city, user_agent, classification, score, calls_today, avg_daily_calls, days_active, first_seen)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11)
             ON CONFLICT (ip) DO UPDATE SET calls_today = $9, last_seen = NOW()`,
            [ip, info.asn, info.isp, info.country, info.city, userAgent, classification, score, calls, daysActive, realFirstSeen ?? new Date()]
          );

          results.newIPs++;
          if (classification === 'developer') results.developers++;
          if (classification === 'crawler')   results.crawlers++;
        }
        results.classified++;
      } catch (e) {
        results.errors++;
        console.error(`[IpClassifier] Error processing ${key}: ${e.message}`);
      }
    }

    // Recompute days_active from real first_seen instead of incrementing by 1 every
    // run (this job runs every 15min, which was inflating days_active ~96x/day).
    await this.q(
      `UPDATE developer_intel di
       SET days_active = GREATEST(1,
         EXTRACT(DAY FROM (NOW() - di.first_seen))::int
       )
       WHERE di.last_seen >= NOW() - INTERVAL '25 hours'
         AND di.first_seen IS NOT NULL
         AND di.first_seen > '2026-01-24'`
    );

    // Re-score AND re-classify every row each run. classify() only runs at INSERT
    // for new IPs, so without this pass existing rows keep stale labels forever even
    // as their volume/tenure change — which is what inflated "developers" and left
    // "scanners" at 0. No extra queries: classification rides the existing score UPDATE.
    const allDevs = await this.q(
      `SELECT ip, user_agent, days_active, avg_daily_calls, calls_today FROM developer_intel`
    );
    for (const dev of allDevs) {
      const score = this.computeScore(dev);
      const classification = this.classify(
        { ua: dev.user_agent }, dev.calls_today, dev.days_active, dev.avg_daily_calls
      );
      await this.q(
        `UPDATE developer_intel SET score = $1, classification = $2 WHERE ip = $3`,
        [score, classification, dev.ip]
      );
    }

    console.log(`[IpClassifier] Done:`, results);
    return results;
  }

  async getDeveloperLeads() {
    return this.q(
      `SELECT * FROM developer_intel WHERE classification IN ('developer','machine') ORDER BY score DESC, days_active DESC`
    );
  }
}
