// Signed-in sessions for /v1/me/sessions — the console never sees a session token.
//
// Better Auth identifies a session to revoke by its TOKEN (the bearer secret).
// The console used to receive every session's token in page props so its
// Revoke button could post it back. Now the console gets opaque session ids
// only; the token is looked up here, server-side, from the signed-in user's
// own session list, and never leaves the API.
import { AccountError } from './keys.mjs';

/** Default adapter over Better Auth's server API (headers carry the caller's cookie). */
export function betterAuthSessionsApi(getAuth) {
  return {
    async list(req) {
      const auth = await getAuth();
      if (!auth) throw new AccountError('accounts_unavailable', 503, 'Sign-in service unavailable');
      const { fromNodeHeaders } = await import('better-auth/node');
      return auth.api.listSessions({ headers: fromNodeHeaders(req.headers) });
    },
    async revoke(req, token) {
      const auth = await getAuth();
      if (!auth) throw new AccountError('accounts_unavailable', 503, 'Sign-in service unavailable');
      const { fromNodeHeaders } = await import('better-auth/node');
      return auth.api.revokeSession({ headers: fromNodeHeaders(req.headers), body: { token } });
    },
  };
}

const iso = (v) => (v ? new Date(v).toISOString() : null);

/** Public shape — no token, ever. */
export async function listSessionsSafe(api, req, currentSessionId) {
  const rows = (await api.list(req)) || [];
  return rows.map((s) => ({
    id: String(s.id),
    createdAt: iso(s.createdAt),
    expiresAt: iso(s.expiresAt),
    userAgent: s.userAgent ?? null,
    ipAddress: s.ipAddress ?? null,
    current: currentSessionId != null && String(s.id) === String(currentSessionId),
  }));
}

export async function revokeSessionById(pool, api, req, sessionId) {
  if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) {
    throw new AccountError('invalid_session_id', 400, 'Bad session id');
  }
  // Only the caller's own sessions are listed by Better Auth, so an id that
  // belongs to another user is simply not found.
  const own = ((await api.list(req)) || []).find((s) => String(s.id) === sessionId);
  if (!own) throw new AccountError('session_not_found', 404, 'No such session on your account');
  await api.revoke(req, own.token);
  const current = req.account.sessionId != null && String(req.account.sessionId) === sessionId;
  await pool.query('INSERT INTO account_audit (account_id, action, subject, detail) VALUES ($1, $2, $3, $4)',
    [req.account.accountId, 'session.revoke', sessionId, JSON.stringify({ current })]);
  return { revoked: sessionId, current };
}
