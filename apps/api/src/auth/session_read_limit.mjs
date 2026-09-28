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
import { CLIENT_IP_HEADER } from './client_ip.mjs';

export const SESSION_READ_PATHS = ['/get-session', '/list-sessions', '/list-accounts'];
export const SESSION_READ_LIMIT = { window: 60, max: 300 };
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
  return 'ip:' + (req.headers?.[CLIENT_IP_HEADER] || 'unknown');
}

/** Fixed-window limiter (single instance; in-memory). `now` is injectable for tests. */
export function createSessionReadLimiter({ window = SESSION_READ_LIMIT.window, max = SESSION_READ_LIMIT.max, now = () => Date.now() } = {}) {
  const buckets = new Map(); // key -> { start, count }
  let lastSweep = now();
  const windowMs = window * 1000;

  return function sessionReadLimit(req, res, next) {
    const sub = (req.params?.splat ? '/' + [].concat(req.params.splat).join('/') : req.path || '').replace(/\/+$/, '');
    if (!SESSION_READ_PATHS.includes(sub)) return next();
    const t = now();
    if (t - lastSweep > windowMs) {
      for (const [k, b] of buckets) if (t - b.start >= windowMs) buckets.delete(k);
      lastSweep = t;
    }
    const key = sessionReadKey(req);
    let b = buckets.get(key);
    if (!b || t - b.start >= windowMs) { b = { start: t, count: 0 }; buckets.set(key, b); }
    b.count += 1;
    if (b.count > max) {
      const retry = Math.max(1, Math.ceil((b.start + windowMs - t) / 1000));
      res.set('Retry-After', String(retry));
      return res.status(429).json({ ok: false, error: 'rate_limited', retryAfter: retry });
    }
    return next();
  };
}
