// Minimal in-memory token-bucket rate limiter, keyed by a string (e.g. IP).
// Per-process only — fine for a single Next server instance; on multi-instance
// deployments this is best-effort. TODO(redis): back with Redis for a shared
// limit if enquiry volume ever warrants it (see docs/web/DECISIONS.md).
type Bucket = { tokens: number; updated: number };
const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

/**
 * @param key      identity (IP)
 * @param capacity max burst
 * @param refillPerSec tokens added per second
 */
export function rateLimit(key: string, capacity = 5, refillPerSec = 5 / 60): RateLimitResult {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: capacity, updated: now };
  const elapsed = (now - b.updated) / 1000;
  b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerSec);
  b.updated = now;

  if (b.tokens < 1) {
    buckets.set(key, b);
    const retryAfterSec = Math.ceil((1 - b.tokens) / refillPerSec);
    return { ok: false, remaining: 0, retryAfterSec };
  }
  b.tokens -= 1;
  buckets.set(key, b);
  return { ok: true, remaining: Math.floor(b.tokens), retryAfterSec: 0 };
}

/** Best-effort client IP from proxy headers. */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return headers.get("x-real-ip") || "unknown";
}
