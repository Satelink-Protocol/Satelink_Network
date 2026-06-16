/**
 * IP Classifier — Satelink Admin
 * Reads REAL free-tier IP counters from Redis and classifies them as
 * developer / machine / crawler / scanner. Persists to developer_intel.
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
      return info;
    } catch (e) {
      console.warn(`[IpClassifier] ip-api.com lookup failed for ${ip}: ${e.message}`);
      return { isp: 'unknown', country: 'unknown', city: 'unknown', asn: '', ua: '' };
    }
  }

  computeScore(dev) {
    let score = 0;
    const ua = (dev.user_agent || '').toLowerCase();
    if (ua.includes('erpc'))        score += 30;
    if (ua.includes('web3.py'))     score += 20;
    if (ua.includes('ethers'))      score += 20;
    if (ua.includes('web3.js'))     score += 18;
    if (ua.includes('viem'))        score += 18;
    if (ua.includes('curl'))        score -= 10;
    if (dev.days_active >= 5)       score += 20;
    else if (dev.days_active >= 3)  score += 10;
    if (dev.avg_daily_calls >= 400) score += 15;
    else if (dev.avg_daily_calls >= 100) score += 8;
    if (ua.includes('masscan') || ua.includes('zgrab')) score -= 50;
    if (ua.includes('bot') || ua.includes('crawler'))   score -= 40;
    return Math.max(0, Math.min(100, score));
  }

  classify(info, calls) {
    const ua = (info.ua || '').toLowerCase();
    if (ua.includes('erpc') || ua.includes('web3.py') || ua.includes('ethers') || ua.includes('viem')) {
      return 'developer';
    }
    if (ua.includes('masscan') || ua.includes('zgrab') || ua.includes('shodan')) {
      return 'scanner';
    }
    if (ua.includes('bot') || ua.includes('crawler') || ua.includes('spider')) {
      return 'crawler';
    }
    if (calls > 200) return 'machine';
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

        const rows = await this.q(
          `SELECT id, days_active, avg_daily_calls FROM developer_intel WHERE ip = $1`,
          [ip]
        );

        if (rows.length > 0) {
          const existing = rows[0];
          const newAvg = Math.round(((existing.avg_daily_calls || 0) + calls) / 2);
          await this.q(
            `UPDATE developer_intel SET calls_today = $1, avg_daily_calls = $2, last_seen = NOW(), updated_at = NOW() WHERE ip = $3`,
            [calls, newAvg, ip]
          );
        } else {
          const info = await this.lookupIP(ip);
          const classification = this.classify(info, calls);
          const score = this.computeScore({ user_agent: info.ua, days_active: 1, avg_daily_calls: calls });

          await this.q(
            `INSERT INTO developer_intel
               (ip, asn, isp, country, city, user_agent, classification, score, calls_today, avg_daily_calls, days_active)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,1)
             ON CONFLICT (ip) DO UPDATE SET calls_today = $9, last_seen = NOW()`,
            [ip, info.asn, info.isp, info.country, info.city, info.ua, classification, score, calls]
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

    await this.q(
      `UPDATE developer_intel SET days_active = days_active + 1 WHERE last_seen >= NOW() - INTERVAL '25 hours'`
    );

    const allDevs = await this.q(`SELECT ip, user_agent, days_active, avg_daily_calls FROM developer_intel`);
    for (const dev of allDevs) {
      const score = this.computeScore(dev);
      await this.q(`UPDATE developer_intel SET score = $1 WHERE ip = $2`, [score, dev.ip]);
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
