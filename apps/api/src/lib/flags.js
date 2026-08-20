// apps/api/src/lib/flags.js
//
// platform_flags reader — the runtime kill-switch backing capacity enforcement.
//
// Fail-closed: any DB error returns the last cached value, or 'legacy' if the
// cache is cold — never a more-permissive path. A 10-second in-process TTL keeps
// this off the per-request hot path; warm-up latency is therefore ≤10s after a
// row UPDATE before every instance observes the new value.
//
// This repo is plain ESM (`.js`, "type":"module"); it has no TypeScript build,
// so this reader is a `.js` module imported directly by the running gateway.
// It mirrors enforcementPath()'s triad (legacy | dual | new) so the DB flag is a
// drop-in replacement for the CAPACITY_ENFORCEMENT_PATH env read, not a
// narrowing of it (losing 'dual' would break the M8 shadow-eval cutover).

const TTL_MS = 10_000;

/** Coerce an arbitrary stored value to the enforcement triad, defaulting to
 * 'legacy' (fail-closed). Matches capacity_enforcement.js enforcementPath(). */
function coerce(value) {
  const v = String(value || '').toLowerCase();
  return v === 'dual' || v === 'new' ? v : 'legacy';
}

let cache = null; // { value, at } | null

/**
 * Read capacity_enforcement_path from platform_flags with a 10s TTL cache.
 * Returns 'legacy' | 'dual' | 'new'. Never throws — fails closed to the cached
 * value, or 'legacy' when the cache is cold.
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<'legacy'|'dual'|'new'>}
 */
export async function getCapacityPath(pool) {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.value;

  try {
    const { rows } = await pool.query(
      `SELECT value FROM platform_flags WHERE key = 'capacity_enforcement_path' LIMIT 1`,
    );
    const value = coerce(rows[0]?.value);
    cache = { value, at: now };
    return value;
  } catch (err) {
    // Structured log only — do not throw. Fail closed.
    console.error({ event: 'flag_read_error', flag: 'capacity_enforcement_path', err: err?.message });
    return cache?.value ?? 'legacy';
  }
}

/** Call this in tests or after a forced flag change to bust the in-process cache. */
export function bustCapacityPathCache() {
  cache = null;
}
