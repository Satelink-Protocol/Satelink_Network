// Step-up verification (Stage 16). A verifier proves the signed-in owner is present
// right now, for one specific challenge. Contract:
//   verify({ principalId, code, request }) → { ok: true, method, userId } | { ok: false, reason }
//   availability({ principalId, request }) → { available: boolean, method }
// It must never create sessions, set cookies or change login state.
import { MandateError } from './errors.mjs';

export const StepUpMethod = Object.freeze({ TOTP: 'totp', PASSKEY: 'passkey' });

/**
 * Adapter over the EXISTING Better Auth TOTP 2FA (apps/api/src/auth/better_auth.mjs).
 * Read-only use of two Better Auth server APIs, no login-flow change:
 *   auth.api.getSession({ headers })            → the caller's session
 *   auth.api.verifyTOTP({ headers, body:{code}}) → on the signed-in path this only verifies
 *     (it creates a session / sets cookies only on the sign-in path, which needs the
 *     two-factor cookie and no session; and it finishes ENROLMENT only when 2FA is not yet
 *     enabled — both are excluded below by requiring an existing session with
 *     twoFactorEnabled === true).
 * Better Auth's lockout applies only to sign-in, so MandateService adds its own attempt
 * cap and code-reuse check.
 *
 * @param {{ getAuth: () => Promise<auth>, authUserIdOf: (principalId) => Promise<string|null> }} deps
 */
export function createBetterAuthTotpVerifier({ getAuth, authUserIdOf }) {
  if (typeof getAuth !== 'function' || typeof authUserIdOf !== 'function') throw new MandateError('CONFIG', 'TOTP verifier needs getAuth and authUserIdOf');
  const sessionFor = async (principalId, request) => {
    const auth = await getAuth();
    if (!auth?.api?.getSession || !auth?.api?.verifyTOTP) throw new MandateError('STEP_UP_UNAVAILABLE', 'Better Auth is not enabled');
    const headers = toHeaders(request?.headers);
    const session = await auth.api.getSession({ headers });
    const expected = await authUserIdOf(principalId);
    if (!session?.user || !session?.session || !expected || session.user.id !== expected) return { auth, headers, session: null };
    return { auth, headers, session };
  };
  return Object.freeze({
    method: StepUpMethod.TOTP,
    async availability({ principalId, request }) {
      const { session } = await sessionFor(principalId, request);
      return { available: Boolean(session && session.user.twoFactorEnabled === true), method: StepUpMethod.TOTP };
    },
    async verify({ principalId, code, request }) {
      if (typeof code !== 'string' || !/^[0-9]{6}$/.test(code)) return { ok: false, reason: 'malformed_code' };
      const { auth, headers, session } = await sessionFor(principalId, request);
      if (!session) return { ok: false, reason: 'no_session_for_principal' };
      if (session.user.twoFactorEnabled !== true) return { ok: false, reason: 'two_factor_not_enabled' };
      try {
        await auth.api.verifyTOTP({ headers, body: { code } });
        return { ok: true, method: StepUpMethod.TOTP, userId: session.user.id };
      } catch {
        return { ok: false, reason: 'invalid_code' };
      }
    },
  });
}

function toHeaders(h) {
  if (h instanceof Headers) return h;
  const out = new Headers();
  for (const [k, v] of Object.entries(h ?? {})) if (typeof v === 'string') out.set(k, v);
  return out;
}
