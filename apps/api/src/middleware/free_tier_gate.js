// apps/api/src/middleware/free_tier_gate.js
// Path C hybrid gate: free tier per IP, then 402 with deposit instructions
// Free tier: FREE_TIER_LIMIT calls/day per IP (default 500)
// Wallet-authenticated requests bypass IP limit entirely → go to creditGate
// Resets daily at midnight UTC. Redis-backed when available; falls back to in-memory.
//
// Anti-abuse env vars (all optional, have safe defaults):
// SUBNET_FREE_LIMIT=500      — Max free calls per /24 subnet per day
// CLUSTER_THRESHOLD=10       — IPs with same UA in 10min window = bot farm
// IGNORED_402_THRESHOLD=50   — 402-ignore escalation trigger count
// BAD_ASNS_ENABLED=1         — Enable/disable bad ASN blocklist
// To add a bad ASN at runtime: update BAD_ASNS constant and redeploy

import { createHash } from 'crypto';
import { paymentRequiredResponse } from '../utils/payment_required.js';

const FREE_TIER_LIMIT = parseInt(process.env.FREE_TIER_DAILY_LIMIT || '500');
// Above this many calls/day an IP is treated as an automated scraper, not a
// prospective customer, and is hard-blocked with 429 instead of billed via 402.
const ABUSE_THRESHOLD = parseInt(process.env.ABUSE_THRESHOLD || '5000');
const LOG_PREFIX = '[FreeTierGate]';

// Layer 1 — known bad ASN blocklist. ASN is written to Redis by ip_classifier.js
// (asn:<ip>, 7d TTL) from its ip-api.com geo lookup; this gate only reads it.
const BAD_ASNS = new Set([
  // Vietnamese datacenter scrapers confirmed Jun 23 2026
  'AS135905', // Vietnam Posts and Telecommunications Group (VPS farms)
  'AS63737',  // VIETSERVER SERVICES TECHNOLOGY COMPANY LIMITED
  // Indonesian mobile/datacenter abusers
  'AS135464', // Winet Media Persada
  // Add more as discovered — format: 'AS<number>'
]);
const BAD_ASNS_ENABLED = process.env.BAD_ASNS_ENABLED !== '0'; // default ON

// Layer 2 — /24 subnet pool cap: an entire subnet shares one free-tier budget,
// so rotating IPs within the same /24 gives zero benefit.
const SUBNET_FREE_LIMIT = parseInt(process.env.SUBNET_FREE_LIMIT || '500');

// Layer 3 — synchronized cluster detection threshold (distinct IPs sharing a UA
// within a 10-minute window).
const CLUSTER_THRESHOLD = parseInt(process.env.CLUSTER_THRESHOLD || '10');

// Layer 4 — persistent 402-ignorer escalation: after this many ignored 402s in
// a day, an IP is hard-blocked with 429 instead of re-served the same 402.
const IGNORED_402_THRESHOLD = parseInt(process.env.IGNORED_402_THRESHOLD || '50');

function getSubnet24(ip) {
  // Returns the /24 prefix: '103.99.1' for '103.99.1.43'
  return ip.split('.').slice(0, 3).join('.');
}

// Extracts the leading 'AS<number>' token from an ip-api.com `as` field, e.g.
// 'AS135905 Vietnam Posts and Telecommunications Group' -> 'AS135905'.
function extractAsnPrefix(asnField) {
  const match = /^AS\d+/.exec(asnField || '');
  return match ? match[0] : null;
}

// Layer 3 helper — tracks distinct IPs sharing a UA fingerprint in a sliding
// window; flags the UA as a cluster (and blocks it for 24h) once the window
// holds too many distinct IPs to be organic traffic.
async function checkClusterAbuse(redis, ua, ip, log) {
  if (!ua || ua === 'unknown') return false;

  const uaSlug = ua.substring(0, 40).replace(/[^a-zA-Z0-9._/-]/g, '_');
  const windowKey = `cluster:${uaSlug}`;
  const blockKey = `cluster_block:${uaSlug}`;

  try {
    const blocked = await redis.get(blockKey);
    if (blocked) return true;
  } catch (_) {
    return false;
  }

  try {
    const now = Date.now();
    const windowMs = 10 * 60 * 1000; // 10-minute window

    await redis.zadd(windowKey, now, ip);
    await redis.zremrangebyscore(windowKey, 0, now - windowMs);
    await redis.expire(windowKey, 3600); // 1h TTL

    const clusterSize = await redis.zcard(windowKey);

    if (clusterSize >= CLUSTER_THRESHOLD) {
      await redis.set(blockKey, clusterSize.toString(), 'EX', 86400);
      log.warn(`${LOG_PREFIX} Bot cluster detected: ua=${uaSlug} ips=${clusterSize}`);
      return true;
    }
  } catch (_) { /* non-critical */ }

  return false;
}

// Module-level Redis reference — set when createFreeTierGate is called
let _redis = null;

// Map<ip, { count, resetAt }> — in-memory fallback when Redis unavailable
// Max 10,000 entries; when full, oldest entries are evicted to prevent OOM during Redis outages
const IP_MAP_MAX = 10000;
const ipCounters = new Map();

function getMidnightUTC() {
  const now = new Date();
  const midnight = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1
  ));
  return midnight.getTime();
}

function getCounter(ip) {
  const now = Date.now();
  const existing = ipCounters.get(ip);

  if (!existing || now >= existing.resetAt) {
    // Evict oldest entry if at capacity
    if (!existing && ipCounters.size >= IP_MAP_MAX) {
      ipCounters.delete(ipCounters.keys().next().value);
    }
    const counter = { count: 0, resetAt: getMidnightUTC() };
    ipCounters.set(ip, counter);
    return counter;
  }
  return existing;
}

// Cleanup old IPs every hour to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [ip, counter] of ipCounters.entries()) {
    if (now >= counter.resetAt) ipCounters.delete(ip);
  }
}, 60 * 60 * 1000);

export function createFreeTierGate(logger, redis) {
  const log = logger || console;
  if (redis) _redis = redis;

  return async function freeTierGate(req, res, next) {
    // Authenticated callers (bound wallet OR API key) skip the per-IP free-tier
    // gate entirely and are handled by creditService (authorizeAndMeter):
    // per-key daily limit, balance deduction, and metering. The credit system is
    // api_credits-keyed, so an X-API-Key caller must NOT be IP-rate-limited as
    // anonymous free traffic — otherwise a funded key is 402'd before deduction.
    const walletHeader = req.headers['x-wallet-address'];
    const apiKeyHeader = req.headers['x-api-key'];
    if (walletHeader || apiKeyHeader) return next();

    // Get real IP (Railway proxies requests)
    const ip =
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.headers['x-real-ip'] ||
      req.socket?.remoteAddress ||
      'unknown';

    // Capture the User-Agent — a software identifier (curl / ethers.js / a browser /
    // a custom SDK), NOT PII. Stored alongside the hashed client_id so traffic can be
    // classified (developer vs crawler) without ever persisting the raw IP. Written only
    // on the first call of the day per IP, so the hot path takes a single extra write.
    const userAgent = (req.headers['user-agent'] || 'unknown').slice(0, 256);

    // Layer 1 — known bad ASN blocklist. asn:<ip> is written by ip_classifier.js
    // from its ip-api.com lookup; a brand-new IP won't have it yet, so we skip
    // (never block) rather than risk a false positive on an unclassified IP.
    if (redis && BAD_ASNS_ENABLED) {
      try {
        const asnField = await redis.get(`asn:${ip}`);
        const asnPrefix = extractAsnPrefix(asnField);
        if (asnPrefix && BAD_ASNS.has(asnPrefix)) {
          log.warn(`${LOG_PREFIX} Bad ASN blocked: ip=${ip} asn=${asnPrefix}`);
          return res.status(429).json({
            ok: false,
            error: 'network_blocked',
            message: 'This network is blocked due to abuse patterns.',
            code: 429
          });
        }
      } catch (_) { /* non-critical — fail open */ }
    }

    // Layer 2 — /24 subnet pool cap: the whole subnet shares one free-tier
    // budget, so rotating IPs within a /24 gives zero benefit.
    if (redis) {
      const subnet24 = getSubnet24(ip);
      const subnetKey = `fts:${subnet24}`;

      let subnetCount = 0;
      try {
        const sv = await redis.get(subnetKey);
        subnetCount = sv ? parseInt(sv) : 0;
      } catch (_) { /* non-critical */ }

      if (subnetCount >= SUBNET_FREE_LIMIT) {
        try {
          await redis.incr(subnetKey);
        } catch (_) { /* non-critical */ }

        log.warn(`${LOG_PREFIX} Subnet blocked: subnet=${subnet24} count=${subnetCount}`);
        return res.status(402).json(paymentRequiredResponse({
          jsonrpc: '2.0',
          id: req.body?.id ?? null,
          error: {
            code: -32005,
            message: 'Subnet free tier limit reached. Each /24 network shares 500 daily calls. Deposit USDT to continue.',
          },
          calls_subnet_today: subnetCount,
          limit: SUBNET_FREE_LIMIT,
        }));
      }

      try {
        const newSubnetCount = await redis.incr(subnetKey);
        if (newSubnetCount === 1) await redis.expire(subnetKey, 90000); // 25h TTL
      } catch (_) { /* non-critical */ }
    }

    let count;
    let resetAt;

    if (redis) {
      try {
        const key = `ft:${ip}`;
        count = await redis.incr(key);
        if (count === 1) {
          const ttl = Math.ceil((getMidnightUTC() - Date.now()) / 1000);
          await redis.expire(key, ttl);
          // First-seen UA for this IP today, same daily TTL as the counter
          await redis.set(`ftua:${ip}`, userAgent, 'EX', ttl);

          // Record true first-seen timestamp — NX means only sets if key doesn't exist.
          // Ground truth for ip_classifier.js; 90-day TTL outlives the daily ft:/ftua: keys,
          // so this is written once per IP ever (until the 90d window lapses).
          try {
            await redis.set(`fs:${ip}`, Date.now().toString(), 'EX', 7776000, 'NX');
          } catch (_) { /* non-critical */ }
        }
        resetAt = getMidnightUTC();
      } catch (err) {
        log.warn(`${LOG_PREFIX} Redis error, using in-memory fallback: ${err.message}`);
        const counter = getCounter(ip);
        counter.count++;
        if (!counter.ua) counter.ua = userAgent;
        count = counter.count;
        resetAt = counter.resetAt;
      }
    } else {
      const counter = getCounter(ip);
      counter.count++;
      if (!counter.ua) counter.ua = userAgent;
      count = counter.count;
      resetAt = counter.resetAt;
    }

    const isDeveloper = classifyUserAgent(userAgent) === 'developer';

    // Abuse tier: >ABUSE_THRESHOLD calls/day from automated, non-developer traffic =
    // a scraper that ignores the 402 and retries. Return 429 with Retry-After so it
    // backs off until midnight UTC instead of hammering the gate and burning Redis
    // quota real customers need. Developer-SDK UAs are exempt — high daily volume is
    // exactly the signal a real paying-intent developer produces, so they fall through
    // to the 402 payment path below at any count.
    if (count > ABUSE_THRESHOLD && !isDeveloper) {
      const secondsUntilReset = Math.max(1, Math.floor((resetAt - Date.now()) / 1000));
      log.warn(`${LOG_PREFIX} Abuse limit exceeded: ip=${ip} count=${count} threshold=${ABUSE_THRESHOLD}`);

      res.set('Retry-After', String(secondsUntilReset));
      return res.status(429).json({
        jsonrpc: '2.0',
        id: req.body?.id ?? null,
        error: {
          code: -32029,
          message: 'Daily request limit exceeded. Automated access detected.',
          data: {
            error_code: 'ABUSE_LIMIT_EXCEEDED',
            calls_today: count,
            limit: ABUSE_THRESHOLD,
            resets_at: new Date(resetAt).toISOString(),
            retry_after_seconds: secondsUntilReset
          }
        }
      });
    }

    // Layer 3 — synchronized cluster detection: the moment an IP first crosses
    // the free-tier limit, check whether many distinct IPs are doing the same
    // thing under the same UA in the same short window (a bot farm signature).
    if (redis && count === FREE_TIER_LIMIT) {
      const isCluster = await checkClusterAbuse(redis, userAgent, ip, log);
      if (isCluster) {
        return res.status(429).json({
          ok: false,
          error: 'cluster_abuse_detected',
          message: 'Coordinated free tier abuse detected. This pattern is blocked.',
          code: 429
        });
      }
    }

    if (count > FREE_TIER_LIMIT) {
      log.warn(`${LOG_PREFIX} Free tier exceeded: ip=${ip} count=${count} limit=${FREE_TIER_LIMIT}`);

      // Layer 4 — persistent 402-ignorer escalation: callers that keep retrying
      // after a 402 waste CPU re-rendering the same response. After enough
      // ignored 402s in a day, escalate to a hard 429 instead.
      if (redis) {
        try {
          const ignoreCount = await redis.incr(`ig:${ip}`);
          if (ignoreCount === 1) await redis.expire(`ig:${ip}`, 90000); // 25h TTL

          if (ignoreCount > IGNORED_402_THRESHOLD) {
            log.warn(`${LOG_PREFIX} 402-ignorer escalated: ip=${ip} ignored=${ignoreCount}`);
            return res.status(429).json({
              ok: false,
              error: 'payment_ignored',
              message: 'Repeated non-payment. Access temporarily suspended.',
              retry_after: 3600,
              code: 429
            });
          }
        } catch (_) { /* non-critical */ }
      }

      const VAULT = process.env.REVENUE_VAULT_ADDRESS || '0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3';
      const USDT = process.env.USDT_CONTRACT_ADDRESS || '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
      const MIN_DEPOSIT = parseFloat(process.env.MIN_DEPOSIT_USDT || '0.50');
      const API_BASE = process.env.API_BASE_URL || 'https://rpc.satelink.network';
      const upgradeUrl = `${API_BASE}/credits/initiate?amount=10`;

      // 402 Payment Required (not 429): a JSON-RPC error a caller's code can act on.
      // 429 was read by RPC clients as "rate limited, back off & retry" — which is why
      // blocked IPs hammered the gate (counter inflated to 775k+) instead of depositing.
      // error.code -32005 ("limit exceeded") is the convention major RPC providers use.
      // Machine-readable top-level fields (ok/code/deposit/docs/notify_url) are
      // merged in for automated payers; the JSON-RPC error object below is
      // preserved verbatim for RPC clients that read error.code -32005.
      return res.status(402).json(paymentRequiredResponse({
        jsonrpc: '2.0',
        id: req.body?.id ?? null,
        error: {
          code: -32005,
          message: 'Free tier daily limit reached. Deposit USDT to continue.',
          data: {
            error_code: 'FREE_TIER_LIMIT_REACHED',
            limit: FREE_TIER_LIMIT,
            period: 'daily',
            resets_at: new Date(resetAt).toISOString(),
            payment: {
              vault_address: VAULT,
              token: 'USDT',
              token_address: USDT,
              chain_id: 137,
              chain_name: 'Polygon',
              minimum_deposit_usdt: MIN_DEPOSIT,
              deposit_url: upgradeUrl,
              // Human-clickable self-service deposit page, alongside the machine
              // deposit_url above (kept as-is for clients already parsing it).
              deposit_page: 'https://app.satelink.network/satelink/os/deposit',
              docs: 'https://docs.satelink.network/paid-tier'
            }
          }
        },
        // legacy top-level fields kept for backward-compat with any existing consumer
        deposit_address: VAULT,
        upgrade_url: upgradeUrl
      }));
    }

    // Under limit — track usage and pass through
    req.freeTierIp = ip;
    req.freeTierCount = count;
    next();
  };
}

// Export current stats for monitoring — reads Redis ft:* keys in production
export async function getFreeTierStats() {
  if (_redis) {
    try {
      const keys = await _redis.keys('ft:*');
      if (!keys || keys.length === 0) {
        return { activeIPs: 0, totalCalls: 0, nearLimitIPs: 0, limit: FREE_TIER_LIMIT };
      }
      const values = await _redis.mget(...keys);
      let totalCalls = 0;
      let nearLimitIPs = 0;
      for (const v of values) {
        const count = parseInt(v, 10) || 0;
        totalCalls += count;
        if (count > FREE_TIER_LIMIT * 0.8) nearLimitIPs++;
      }
      return { activeIPs: keys.length, totalCalls, nearLimitIPs, limit: FREE_TIER_LIMIT };
    } catch (err) {
      // Fall through to in-memory
    }
  }
  const now = Date.now();
  let activeIPs = 0;
  let totalCalls = 0;
  let nearLimitIPs = 0;
  for (const [, counter] of ipCounters.entries()) {
    if (now < counter.resetAt) {
      activeIPs++;
      totalCalls += counter.count;
      if (counter.count > FREE_TIER_LIMIT * 0.8) nearLimitIPs++;
    }
  }
  return { activeIPs, totalCalls, nearLimitIPs, limit: FREE_TIER_LIMIT };
}

// Export conversion targets: IPs at >=90% of free tier limit
export async function getConversionTargets() {
  const threshold = FREE_TIER_LIMIT * 0.9;

  if (_redis) {
    try {
      const keys = await _redis.keys('ft:*');
      if (!keys || keys.length === 0) return [];
      const values = await _redis.mget(...keys);

      // Collect only the over-threshold IPs first, then one mget for their UAs.
      const qualifying = [];
      for (let i = 0; i < keys.length; i++) {
        const count = parseInt(values[i], 10) || 0;
        if (count >= threshold) qualifying.push({ ip: keys[i].slice(3), count }); // strip 'ft:' prefix
      }
      const uaMap = {};
      if (qualifying.length) {
        const uaVals = await _redis.mget(...qualifying.map(q => `ftua:${q.ip}`));
        qualifying.forEach((q, i) => { uaMap[q.ip] = uaVals[i] || 'unknown'; });
      }

      const targets = qualifying.map(q => {
        const ua = uaMap[q.ip] || 'unknown';
        return {
          client_id: hashIp(q.ip),
          calls_today: q.count,
          limit: FREE_TIER_LIMIT,
          threshold_pct: Math.round((q.count / FREE_TIER_LIMIT) * 100),
          exceeded: q.count > FREE_TIER_LIMIT,
          user_agent: ua,
          classification: classifyUserAgent(ua),
          resets_at: new Date(getMidnightUTC()).toISOString()
        };
      });
      targets.sort((a, b) => b.calls_today - a.calls_today);
      return targets;
    } catch (err) {
      // Fall through to in-memory
    }
  }

  const now = Date.now();
  const targets = [];
  for (const [ip, counter] of ipCounters.entries()) {
    if (now < counter.resetAt && counter.count >= threshold) {
      const ua = counter.ua || 'unknown';
      targets.push({
        client_id: hashIp(ip),
        calls_today: counter.count,
        limit: FREE_TIER_LIMIT,
        threshold_pct: Math.round((counter.count / FREE_TIER_LIMIT) * 100),
        exceeded: counter.count > FREE_TIER_LIMIT,
        user_agent: ua,
        classification: classifyUserAgent(ua),
        resets_at: new Date(counter.resetAt).toISOString()
      });
    }
  }
  targets.sort((a, b) => b.calls_today - a.calls_today);
  return targets;
}

// Hash IP for privacy in logs/exports
function hashIp(ip) {
  return 'IP-' + createHash('sha256').update(ip + (process.env.IP_HASH_SALT || 'satelink')).digest('hex').substring(0, 12);
}

// Classify a User-Agent into a coarse traffic type. Heuristic, not authoritative — a
// first signal for separating developers/dApps from scripts and automated crawlers.
// Ordering matters: SDK/library markers are checked before generic HTTP-client markers
// (e.g. an ethers.js request riding on node-fetch should classify as 'developer').
export function classifyUserAgent(ua) {
  if (!ua || ua === 'unknown') return 'unknown';
  const s = ua.toLowerCase();
  if (/(ethers|web3|viem|wagmi|go-ethereum|geth|hardhat|foundry|truffle|alchemy|infura|rpc)/.test(s)) return 'developer';
  if (/(bot|spider|crawl|scrapy|slurp|headless|phantom)/.test(s)) return 'crawler';
  if (/(curl|wget|python|go-http|java\/|okhttp|axios|node-fetch|undici|got\/|libwww|httpx|reqwest|guzzle|postman)/.test(s)) return 'script';
  if (/(mozilla|chrome|safari|firefox|edg\/|opera)/.test(s)) return 'browser';
  return 'other';
}
