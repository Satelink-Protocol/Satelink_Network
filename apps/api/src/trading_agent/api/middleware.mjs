// Stage 24 API middleware: flag gate, authentication, CSRF, rate limits, idempotency, step-up.
import { createHash } from 'node:crypto';
import { isTradingFlagEnabled } from '../flags.mjs';
import { ApiError, errorBody } from './errors.mjs';

export const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const send = (res, e) => { const { status, body } = errorBody(e); if (e?.retryAfter) res.set('Retry-After', String(e.retryAfter)); res.status(status).json(body); };
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => send(res, e));

/** Flag off ⇒ 404 for everything under the router (indistinguishable from an unknown path). */
export function flagGate(flag, env) {
  return (req, res, next) => (isTradingFlagEnabled(flag, env) ? next() : res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'not found' } }));
}

/**
 * @param resolvePrincipal async req → { principalId, kind: 'human'|'agent', via: 'session'|'api_key' } | null
 * The principal comes ONLY from authentication; a principalId in the body or query must match it.
 */
export function authenticate(resolvePrincipal) {
  return wrap(async (req, _res, next) => {
    const p = await resolvePrincipal(req);
    if (!p || typeof p.principalId !== 'string' || !/^prn_[A-Za-z0-9_-]{3,64}$/.test(p.principalId)) throw new ApiError(401, 'UNAUTHENTICATED', 'authentication required');
    for (const src of [req.body, req.query]) {
      if (src && Object.hasOwn(src, 'principalId') && src.principalId !== p.principalId) throw new ApiError(403, 'TENANT_MISMATCH', 'principalId does not match the authenticated principal');
    }
    req.principal = Object.freeze({ principalId: p.principalId, kind: p.kind === 'human' ? 'human' : 'agent', via: p.via ?? 'session', role: 'user' });
    next();
  });
}

/** Session-authenticated mutations need JSON, X-Satelink-Client: 1 and (if sent) a trusted Origin. */
export function csrfGuard({ trustedOrigins = [] } = {}) {
  return wrap(async (req, _res, next) => {
    if (!MUTATING.has(req.method)) return next();
    if (!req.is('application/json')) throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'application/json required');
    if (req.principal?.via === 'session') {
      if (req.get('x-satelink-client') !== '1') throw new ApiError(403, 'CSRF', 'X-Satelink-Client header required');
      const origin = req.get('origin');
      if (origin && !trustedOrigins.includes(origin)) throw new ApiError(403, 'CSRF', 'origin not allowed');
    }
    next();
  });
}

/** REST mutations are for humans; agents use the MCP surface (read + propose only). */
export function humanForMutations() {
  return wrap(async (req, _res, next) => {
    if (MUTATING.has(req.method) && req.principal?.kind !== 'human') throw new ApiError(403, 'HUMAN_REQUIRED', 'agents may only read and propose (use the MCP tools)');
    next();
  });
}

/** Fixed-window limiter per principal and class (read / write / step-up). */
export function rateLimiter({ clock = () => new Date(), limits = { read: 120, write: 30, stepUp: 5 }, windowMs = 60_000 } = {}) {
  const hits = new Map();
  return (cls) => wrap(async (req, _res, next) => {
    const now = clock().getTime();
    const window = Math.floor(now / windowMs);
    const key = `${req.principal.principalId}|${cls}|${window}`;
    const n = (hits.get(key) ?? 0) + 1;
    hits.set(key, n);
    if (hits.size > 10_000) for (const k of hits.keys()) if (!k.endsWith(`|${window}`)) hits.delete(k);
    if (n > limits[cls]) throw Object.assign(new ApiError(429, 'RATE_LIMITED', 'rate limit exceeded'), { retryAfter: Math.ceil(((window + 1) * windowMs - now) / 1000) });
    next();
  });
}

export class InMemoryIdempotencyStore {
  #rows = new Map();
  async begin(key, fingerprint, now, ttlMs) {
    const r = this.#rows.get(key);
    if (r && r.expiresAt > now) return r.fingerprint !== fingerprint ? { state: 'conflict' } : r.done ? { state: 'replay', status: r.status, body: r.body } : { state: 'in_progress' };
    this.#rows.set(key, { fingerprint, done: false, expiresAt: now + ttlMs });
    return { state: 'new' };
  }
  async complete(key, status, body) { const r = this.#rows.get(key); if (r) Object.assign(r, { done: true, status, body: structuredClone(body) }); }
  async release(key) { this.#rows.delete(key); }
}

const canonical = (v) => (v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`);
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * Idempotency-Key on every mutation. Same key + same request → the stored response is replayed
 * (Idempotent-Replayed: true); same key + different request → 422; still running → 409. Keys are
 * scoped to the principal. 5xx responses are not stored (the client may retry).
 */
export function idempotency({ store, clock = () => new Date(), ttlMs = 24 * 3_600_000 }) {
  return wrap(async (req, res, next) => {
    if (!MUTATING.has(req.method)) return next();
    const raw = req.get('idempotency-key');
    if (!raw || !IDEMPOTENCY_KEY_RE.test(raw)) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header (8–128 of [A-Za-z0-9_-]) required on mutations');
    const key = `${req.principal.principalId}|${raw}`;
    const fingerprint = createHash('sha256').update(`${req.method} ${req.baseUrl}${req.path}\n${canonical(req.body ?? null)}`).digest('hex');
    const r = await store.begin(key, fingerprint, clock().getTime(), ttlMs);
    if (r.state === 'conflict') throw new ApiError(422, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was used for a different request');
    if (r.state === 'in_progress') throw new ApiError(409, 'IDEMPOTENCY_IN_PROGRESS', 'a request with this Idempotency-Key is still running');
    if (r.state === 'replay') { res.set('Idempotent-Replayed', 'true'); return res.status(r.status).json(r.body); }
    req.idempotencyKey = raw;
    const json = res.json.bind(res);
    res.json = (body) => {
      const p = res.statusCode >= 500 ? store.release(key) : store.complete(key, res.statusCode, body);
      Promise.resolve(p).catch(() => {});
      return json(body);
    };
    next();
  });
}

/** Step-up (TOTP / passkey) via the Stage 16 verifier: header X-Satelink-Step-Up carries the code. */
export function requireStepUp(stepUp) {
  return wrap(async (req, _res, next) => {
    const code = req.get('x-satelink-step-up');
    if (!code) throw new ApiError(401, 'STEP_UP_REQUIRED', 'this action needs step-up verification (X-Satelink-Step-Up)');
    const v = await stepUp.verify({ principalId: req.principal.principalId, code, request: { ip: req.ip, userAgent: req.get('user-agent') ?? null } });
    if (!v || v.ok !== true) throw new ApiError(401, 'STEP_UP_FAILED', 'step-up verification failed');
    req.stepUp = Object.freeze({ method: v.method ?? 'totp' });
    next();
  });
}
