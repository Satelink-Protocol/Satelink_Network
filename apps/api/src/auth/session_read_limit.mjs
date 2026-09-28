// Rate limit for the read-only session endpoints, keyed per SESSION, not per IP.
//
// The console server-renders every page from Vercel's shared egress IPs and
// calls get-session (plus sidebar prefetches). Better Auth's per-IP limit
// (20/min) returned 429 after ~11 calls and signed console users out
// (2026-09-28). These reads are limited here instead: 300/min per session
// token (hashed, never stored raw); requests without a session cookie fall
// back to the trusted client IP (client_ip.mjs). Sign-in and every write stay
// on Better Auth's per-IP limits.
import { createHash } from 'node:crypto';
import { CLIENT_IP_HEADER, ipBucket } from './client_ip.mjs';

export const SESSION_READ_PATHS = ['/get-session', '/list-sessions', '/list-accounts'];
export const SESSION_READ_LIMIT = { window: 60, max: 300 };
// Backstop per trusted client IP (IPv6 /64): a session cookie is not verified
// here, so rotating random cookie values must not buy unlimited reads.
export const SESSION_READ_IP_LIMIT = { window: 60, max: 600 };
export const MAX_BUCKETS = 100_000;
const BASE_PATH = '/api/identity';

/** The sub-path Better Auth will route to: WHATWG URL resolution (dot segments,
 *  %2e) like better-call's Request, then basePath and trailing slash removed. */
export function identitySubPath(originalUrl) {
  let p;
  try { p = new URL(originalUrl, 'http://x').pathname; } catch { return null; }
  if (!p.startsWith(BASE_PATH + '/')) return null;
  return p.slice(BASE_PATH.length).replace(/\/+$/, '');
}
const SESSION_COOKIES = ['__Secure-satelink.session_token', 'satelink.session_token'];

function sessionToken(cookieHeader) {
  if (typeof cookieHeader !== 'string') return null;
  for (const part of cookieHeader.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (SESSION_COOKIES.includes(name)) {
      const v = part.slice(i + 1).trim();
      if (v) return v;
    }
  }
  return null;
}

export function sessionReadKey(req) {
  const tok = sessionToken(req.headers?.cookie);
  if (tok) return 's:' + createHash('sha256').update(tok).digest('hex');
  return 'ip:' + (ipBucket(req.headers?.[CLIENT_IP_HEADER]) || 'unknown');
}

/** Fixed-window limiter (single instance; in-memory, bounded). `now` is injectable for tests. */
export function createSessionReadLimiter({
  window = SESSION_READ_LIMIT.window, max = SESSION_READ_LIMIT.max,
  ipMax = SESSION_READ_IP_LIMIT.max, maxBuckets = MAX_BUCKETS, now = () => Date.now(),
} = {}) {
  const buckets = new Map(); // key -> { start, count }; insertion order = age
  let lastSweep = now();
  const windowMs = window * 1000;

  const hit = (key, t) => {
    let b = buckets.get(key);
    if (!b || t - b.start >= windowMs) {
      if (b) buckets.delete(key);
      b = { start: t, count: 0 };
      buckets.set(key, b);
      while (buckets.size > maxBuckets) buckets.delete(buckets.keys().next().value);
    }
    b.count += 1;
    return b;
  };

  return function sessionReadLimit(req, res, next) {
    const sub = identitySubPath(req.originalUrl || req.url || '');
    if (!SESSION_READ_PATHS.includes(sub)) return next();
    const t = now();
    if (t - lastSweep > windowMs) {
      for (const [k, b] of buckets) if (t - b.start >= windowMs) buckets.delete(k);
      lastSweep = t;
    }
    const ipKey = 'ip:' + (ipBucket(req.headers?.[CLIENT_IP_HEADER]) || 'unknown');
    const ipB = hit(ipKey, t);
    const key = sessionReadKey(req);
    const b = key === ipKey ? ipB : hit(key, t);
    const over = ipB.count > ipMax ? ipB : (b.count > max ? b : null);
    if (over) {
      const retry = Math.max(1, Math.ceil((over.start + windowMs - t) / 1000));
      res.set('Retry-After', String(retry));
      return res.status(429).json({ ok: false, error: 'rate_limited', retryAfter: retry });
    }
    return next();
  };
}
