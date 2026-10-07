// Admin step-up (Stage 28, option 1). Staff-only trading actions need BOTH:
//   1. a server-verified staff principal (injected isStaff — never a cookie or client claim), and
//   2. a fresh step-up proof from the EXISTING verifier (authorization/step_up.mjs, Better Auth TOTP).
// Every attempt, allowed or denied, is written to an injected append-only audit sink. Codes are
// single-use per (principal, action) within the replay window.
import { SecurityError } from './errors.mjs';

export const ADMIN_ACTIONS = Object.freeze([
  'kill_switch.global.release',   // releasing a platform-wide switch
  'kill_switch.admin.release',    // releasing any admin-engaged switch
  'risk_policy.update',           // changing hard caps / policy
  'mandate.admin_revoke',         // revoking a user's mandate
  'credential.decrypt_grant',     // granting the credential-decrypt DB role
  'broker_key.recheck_override',  // clearing a failed daily key re-check
  'proposal.admin_approve',       // approving a proposal on behalf of the platform
]);

export function createAdminStepUpGuard({ isStaff, stepUp, audit, clock = () => new Date(), replayWindowMs = 5 * 60_000 }) {
  if (typeof isStaff !== 'function' || typeof stepUp?.verify !== 'function' || typeof audit?.append !== 'function') {
    throw new SecurityError('CONFIG', 'admin step-up needs isStaff, a step-up verifier and an audit sink');
  }
  const used = new Map(); // `${principal}|${action}|${code}` → expiry ms
  const record = async (entry) => { await audit.append(Object.freeze({ kind: 'admin_step_up', at: clock().toISOString(), ...entry })); };

  return Object.freeze({
    /** → { ok: true, method } or throws SecurityError(FORBIDDEN | STEP_UP_REQUIRED | STEP_UP_FAILED | INVALID). */
    async authorize({ principalId, action, code, request }) {
      if (!ADMIN_ACTIONS.includes(action)) throw new SecurityError('INVALID', `not an admin action: ${action}`);
      if (typeof principalId !== 'string' || !principalId) throw new SecurityError('FORBIDDEN', 'no principal');
      if (!(await isStaff(principalId))) { await record({ principalId, action, outcome: 'denied', reason: 'not_staff' }); throw new SecurityError('FORBIDDEN', 'staff only'); }
      if (typeof code !== 'string' || !code) { await record({ principalId, action, outcome: 'denied', reason: 'no_code' }); throw new SecurityError('STEP_UP_REQUIRED', 'step-up code required'); }
      const now = clock().getTime();
      for (const [k, exp] of used) if (exp <= now) used.delete(k);
      const replayKey = `${principalId}|${action}|${code}`;
      if (used.has(replayKey)) { await record({ principalId, action, outcome: 'denied', reason: 'code_reused' }); throw new SecurityError('STEP_UP_FAILED', 'step-up code already used'); }
      const r = await stepUp.verify({ principalId, code, request });
      if (!r?.ok) { await record({ principalId, action, outcome: 'denied', reason: r?.reason ?? 'invalid' }); throw new SecurityError('STEP_UP_FAILED', 'step-up failed'); }
      used.set(replayKey, now + replayWindowMs);
      await record({ principalId, action, outcome: 'allowed', method: r.method });
      return Object.freeze({ ok: true, method: r.method });
    },
  });
}

/** Express middleware: req.principal.id + header X-Step-Up-Code. 403 / 401 with a stable code. */
export function requireAdminStepUp(guard, action) {
  return async (req, res, next) => {
    try {
      await guard.authorize({ principalId: req.principal?.id, action, code: req.get?.('x-step-up-code') ?? req.headers?.['x-step-up-code'], request: req });
      next();
    } catch (e) {
      const status = e.code === 'FORBIDDEN' ? 403 : e.code === 'INVALID' ? 400 : 401;
      res.status(status).json({ ok: false, error: { code: e.code ?? 'STEP_UP_FAILED' } });
    }
  };
}
