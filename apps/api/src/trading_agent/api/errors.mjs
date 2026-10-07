// API error envelope (Stage 24). Domain errors keep their `code`; the HTTP status comes from this
// table. Unknown errors become 500 INTERNAL with a generic message (no internals leak).
export class ApiError extends Error {
  constructor(status, code, message) { super(message ?? code); this.status = status; this.code = code; }
}

const STATUS_BY_CODE = Object.freeze({
  INVALID: 400, INVALID_REQUEST: 400, INVALID_ORDER: 400, SCHEMA_INVALID: 400, BAD_REQUEST: 400, IDEMPOTENCY_KEY_REQUIRED: 400,
  UNAUTHENTICATED: 401, STEP_UP_REQUIRED: 401, STEP_UP_FAILED: 401, STEP_UP_UNAVAILABLE: 401, SIGNATURE_INVALID: 401,
  FORBIDDEN: 403, PERMISSION_DENIED: 403, CSRF: 403, HUMAN_REQUIRED: 403, TENANT_MISMATCH: 403, LOCKED_MODE: 403,
  NOT_FOUND: 404, ORDER_NOT_FOUND: 404,
  CONFLICT: 409, ILLEGAL_TRANSITION: 409, REVOKED: 409, EXPIRED: 409, NOT_ACTIVE: 409, NOT_YET_VALID: 409, REPLAY: 409, HASH_MISMATCH: 409,
  CHALLENGE_EXPIRED: 409, IDEMPOTENCY_IN_PROGRESS: 409,
  UNSUPPORTED_MEDIA_TYPE: 415, IDEMPOTENCY_KEY_REUSED: 422, REFUSED: 422,
  RATE_LIMITED: 429, ATTEMPTS_EXCEEDED: 429,
  NOT_IMPLEMENTED: 501,
});

export function statusFor(code) { return STATUS_BY_CODE[code] ?? 500; }

export function errorBody(e) {
  const status = e instanceof ApiError ? e.status : statusFor(e?.code);
  const safe = status < 500;
  return { status, body: { ok: false, error: { code: safe ? e.code : 'INTERNAL', message: safe ? String(e.message ?? e.code) : 'internal error' } } };
}

export const notImplemented = (what) => new ApiError(501, 'NOT_IMPLEMENTED', `${what} is not available yet`);
