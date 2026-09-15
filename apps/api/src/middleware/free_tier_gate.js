// apps/api/src/middleware/free_tier_gate.js
// Path C hybrid gate: free tier per IP, then 402 with deposit instructions
// Free tier: FREE_TIER_LIMIT calls/day per IP (default 500)
// A valid API key bypasses the IP limit entirely → billed via creditGate/
// creditService. x-wallet-address alone does NOT bypass (P0-wallet-auth,
// 2026-09) — it names no verified identity.
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
import { createUpgradeContext } from './upgrade_context.js';

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

// ── Anonymous free-tier cut (2026-08-10) ─────────────────────────────────────
// A request is ANONYMOUS iff it carries NONE of the recognized authentication
// signals below (headers OR query params, case-insensitive, empty value counts
// as absent). This set is kept in sync with the x402 + auth middleware audit
// (Part 0, 2026-08-10): wallet/API-key are already short-circuited at the top of
// the gate; the remaining signals (authorization, admin/enterprise keys, x402
// payer/payment headers, ?api_key/?token) mark an authenticated caller so they
// are NOT throttled as anonymous free traffic. req.headers keys are already
// lowercased by Node, so lowercase names here give case-insensitive matching.
const AUTH_SIGNAL_HEADERS = [
  'x-api-key', 'authorization', 'x-admin-key', 'x-admin-token',
  'x-enterprise-key', 'x-payer-address', 'x-wallet-address',
  'payment-signature', 'x-payment',
];
const AUTH_SIGNAL_QUERY = ['api_key', 'token'];

function hasAuthSignal(req) {
  const headers = req.headers || {};
  for (const h of AUTH_SIGNAL_HEADERS) {
    const v = headers[h];
    if (v != null && String(v).length > 0) return true;
  }
  const q = req.query || {};
  for (const name of AUTH_SIGNAL_QUERY) {
    const v = q[name];
    if (v != null && String(v).length > 0) return true;
  }
  return false;
}

// Free calls granted to ANONYMOUS callers before the x402 402 challenge is
// returned. Default 0 → the challenge is served on the very first anonymous
// request (no free RPC bodies for unauthenticated traffic). A positive integer
// restores a per-IP anonymous quota. Read at REQUEST time (not module load) so
// a Railway env-var change takes effect on the container restart it triggers —
// instant rollback with no code redeploy. Invalid/negative values fail closed
// to 0 (never unlimited: `count > NaN` would silently disable the gate).
function anonFreeCalls() {
  const raw = parseInt(process.env.FREE_TIER_ANON_CALLS ?? '0', 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

// Free calls granted to callers that present a NON-wallet/non-API-key auth signal
// (e.g. `authorization`, `x-payer-address`, `?api_key`). Default 0 as of the
// 2026-08-27 free-tier removal: /rpc/* now requires x-wallet-address or x-api-key
// (both short-circuit to next() at the top of the gate) or a settled x402 payment
// (bypasses this gate upstream). Every other caller gets a 402 with deposit
// instructions on the FIRST call and never reaches the RPC gateway — so nothing
// is written to the money path. FREE_TIER_DAILY_LIMIT is the emergency rollback
// lever, read at REQUEST time so a Railway env change restores the tier on the
// container restart it triggers, with no code redeploy. Fails closed to 0.
function freeTierCalls() {
  const raw = parseInt(process.env.FREE_TIER_DAILY_LIMIT ?? '0', 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : 0;
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

export function createFreeTierGate(logger, redis, pool = null) {
  const log = logger || console;
  if (redis) _redis = redis;
  // Conversion patch (2026-07-11): personalized honest upgrade math on the
  // wall 402s. Synchronous cache read + background fill — adds no latency and
  // no failure mode to the gate (see upgrade_context.js). Limits unchanged.
  const upgradeContextFor = createUpgradeContext({ pool, redis, log });

  return async function freeTierGate(req, res, next) {
    // Authenticated callers (a real API key) skip the per-IP free-tier gate
    // entirely and are handled by creditService (authorizeAndMeter): per-key
    // daily limit, balance deduction, and metering. The credit system is
    // api_credits-keyed, so an X-API-Key caller must NOT be IP-rate-limited as
    // anonymous free traffic — otherwise a funded key is 402'd before deduction.
    //
    // P0-wallet-auth (2026-09): x-wallet-address is NOT checked here anymore.
    // It named no verified identity — a fabricated value bypassed this gate
    // for free, and billing downstream no longer accepts it either (a bare
    // wallet header now gets a 401 from rpc_gateway.js/credit_gate.js, so
    // letting it skip throttling here would only buy a free ride to that 401).
    // x-api-key presence (not shape/validity) is UNCHANGED by this fix: the
    // gate was never the vulnerability for keys — a fabricated key still gets
    // correctly rejected downstream by authorizeAndMeter (401 unknown key),
    // it just isn't IP-throttled first. That's a documented, tested tradeoff
    // (test/free_tier_gate.test.js), distinct from the wallet-header issue,
    // which could actually BILL an unverified identity.
    const apiKeyHeader = req.headers['x-api-key'];
    if (apiKeyHeader) return next();

    // Gate M0(a) (2026-09-15): a bare x-wallet-address is an insufficient
    // credential — answer 401 here, the same body rpc_gateway.js returns,
    // instead of rate-limiting it as anonymous. Before this, the response
    // depended on the caller's /24 budget: 401 from the gateway while budget
    // remained, the legacy free-tier 402 once it was spent. Either way it was
    // never served or billed; this makes the rejection uniform and stops junk
    // wallet headers from consuming the subnet's free budget. A settled x402
    // payment never reaches this gate (freeTierGateUnlessX402Paid).
    if (req.headers['x-wallet-address']) {
      return res.status(401).json({
        ok: false,
        error: 'wallet_header_insufficient',
        message: 'x-wallet-address alone is not a billing credential. Present a valid X-API-Key (see POST /v1/machine/register) or pay via x402.'
      });
    }

    // Free tier removed (2026-08-27): the ONLY ways past this gate are (1) an
    // x-api-key header — returned next() above — or
    // (2) a settled x402 payment, which bypasses this gate entirely upstream
    // (freeTierGateUnlessX402Paid in app_factory.mjs). Any caller reaching this
    // line therefore has NO recognized paid credential; its effective allowance
    // is 0, so it 402s on the first call and never reaches billing. Both limits
    // default 0 and are read at request time (FREE_TIER_ANON_CALLS /
    // FREE_TIER_DAILY_LIMIT) purely as emergency rollback levers.
    const anonymous = !hasAuthSignal(req);
    const effectiveLimit = anonymous ? anonFreeCalls() : freeTierCalls();

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
          // 402, not a bare 429: these are machines, and a machine that gets a
          // structured 402 can register + deposit and come back as a paying
          // key (keyed callers bypass this gate entirely, so the ASN block
          // never touches them). A bodyless hard block converts nobody.
          // Free tier stays denied for these networks — only the paid path
          // is offered.
          return res.status(402).json(paymentRequiredResponse({
            jsonrpc: '2.0',
            id: req.body?.id ?? null,
            error: {
              code: -32005,
              message:
                'Free tier is unavailable for this network due to abuse patterns. ' +
                'Paid access is available: register a wallet, deposit USDT, and retry with X-API-Key.',
              data: {
                error_code: 'NETWORK_FREE_TIER_BLOCKED',
                asn: asnPrefix,
              },
            },
          }));
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
            // error.message is the ONE string that reaches human operators (their
            // client library throws it into logs/exception trackers). 11,202
            // impressions proved the rest of the 402 body is write-only — this
            // string must carry the whole ask (2026-07-11).
            message: 'Satelink: shared /24 free tier exhausted (500/day). Rate limited (free tier). Remove this limit with a free machine key — no wallet, no email: curl -X POST https://rpc.satelink.network/v1/machine/register -H \'Content-Type: application/json\' -d \'{"mode":"instant"}\' — then send the returned key as X-API-Key.',
          },
          calls_subnet_today: subnetCount,
          limit: SUBNET_FREE_LIMIT,
          // Personalized honest upgrade math from THIS caller's measured
          // usage (subnet total today + per-IP history when cached). The
          // subnet budget equals the per-IP limit, so this is the wall most
          // over-cap traffic actually sees.
          upgrade: upgradeContextFor({ ip, subnet: subnet24, subnetCount }),
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

    if (count > effectiveLimit) {
      log.warn(`${LOG_PREFIX} Free tier exceeded: ip=${ip} count=${count} limit=${effectiveLimit} anonymous=${anonymous}`);

      // Layer 4 — persistent 402-ignorer escalation: callers that keep retrying
      // after a 402 waste CPU re-rendering the same response. After enough
      // ignored 402s in a day, escalate to a hard 429 instead.
      if (redis) {
        try {
          const ignoreCount = await redis.incr(`ig:${ip}`);
          if (ignoreCount === 1) await redis.expire(`ig:${ip}`, 90000); // 25h TTL

          if (false && ignoreCount > IGNORED_402_THRESHOLD) {
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

      const VAULT = process.env.REVENUE_VAULT_ADDRESS || '0x577D3716d6Ad5b676d230f5409deF9838FABaCEF';
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
          // See subnet-402 note: error.message is the only human-visible string.
          // error_code stays FREE_TIER_LIMIT_REACHED for backward-compat (RPC
          // clients + x402 middleware match on it); the free tier is removed, so
          // effectiveLimit is 0 and this fires on the first unauthenticated call.
            message: 'Satelink: /rpc requires authentication — there is no free tier. Get a free machine key in one call — no wallet, no email: curl -X POST https://rpc.satelink.network/v1/machine/register -H \'Content-Type: application/json\' -d \'{"mode":"instant"}\' — then send the returned key as X-API-Key.',
          data: {
            error_code: 'FREE_TIER_LIMIT_REACHED',
            limit: effectiveLimit,
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
              // Anonymous self-onboarding: POST wallet_address + EIP-191
              // signature, no prior key needed — returns the api_key that
              // deposits from that wallet auto-credit.
              register_url: `${API_BASE}/v1/machine/register`,
              // Human-clickable self-service deposit page, alongside the machine
              // deposit_url above (kept as-is for clients already parsing it).
              // Apex domain: app.satelink.network is a dead Vercel alias
              // (DEPLOYMENT_NOT_FOUND) and docs.satelink.network/paid-tier
              // never existed — both 404'd as of 2026-07-04.
              deposit_page: 'https://satelink.network/satelink/os/deposit',
              docs: 'https://satelink.network/docs'
            }
          }
        },
        // legacy top-level fields kept for backward-compat with any existing consumer
        deposit_address: VAULT,
        upgrade_url: upgradeUrl,
        // Personalized honest upgrade math from THIS caller's measured usage
        // (today's counter + developer_intel history once cached).
        upgrade: upgradeContextFor({ ip, requestsToday: count }),
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
