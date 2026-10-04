// MandateService (Stage 16): every live action traces to a user-signed mandate.
//
//   propose  → draft row: canonical terms + hash + one-time nonce + signing challenge
//   sign     → owner passes step-up (TOTP today) for exactly that hash + nonce → active,
//              with an HMAC attestation; the previous version of the lineage is superseded
//   revoke   → revoked; future orders cancelled (unsent) or cancel-requested (at broker)
//   expire   → past validUntil → expired; same order handling
//   emergencyShutdown → principal (or, admin only, global) kill switch FIRST, then revoke all
//   verifyForOrder → the risk engine's mandate source: integrity, signature, state, window
//
// Who: propose / sign = the owning human user only (never admins, never agents).
// Revoke = owner, admin or the platform. Agents can do none of these.
// Every action appends an audit_events row ('mandate.*').
import { randomBytes } from 'node:crypto';
import { MandateError } from './errors.mjs';
import { defineTerms, hashTerms, DRAFT_FIELDS, MANDATE_TERMS_TAG, MODE_TO_021 } from './terms.mjs';
import { assertSigner, signMandate, verifyMandateSignature, signingChallenge, stepUpFingerprint } from './signing.mjs';
import { isTradingFlagEnabled } from '../flags.mjs';

const DAY = 86_400_000;
const isUser = (a) => a?.kind === 'human' && a.role === 'user' && typeof a.principalId === 'string';
const isAdmin = (a) => a?.kind === 'human' && a.role === 'admin' && typeof a.principalId === 'string';
const isPlatform = (a) => a?.kind === 'platform' && typeof a.principalId === 'string';
const actorLabel = (a) => (isAdmin(a) ? `staff:${a.principalId}` : isPlatform(a) ? 'system' : `user:${a.principalId}`);
const actorType = (a) => (isAdmin(a) ? 'staff' : isPlatform(a) ? 'system' : 'user');

export class MandateService {
  #s; #stepUp; #signer; #accounts; #strategies; #kill; #clock; #ids; #nonce; #env; #o;

  /**
   * @param deps.store        InMemoryMandateStore | PgMandateStore
   * @param deps.stepUp       a step-up verifier (step_up.mjs contract)
   * @param deps.signer       { keyId, secret: Buffer(≥32) } — KMS-held in production (B-08)
   * @param deps.accounts     { get(brokerAccountId) → { id, principalId, broker, environment, status } | null }
   * @param deps.strategies   optional { getVersion(versionId) → { strategyId, definitionHash } }
   * @param deps.killSwitches Stage 15 KillSwitchService (for emergencyShutdown)
   * @param deps.env          flag environment; defaults to {} (all off), never process.env
   */
  constructor({ store, stepUp, signer, accounts, strategies = null, killSwitches = null, clock = () => new Date(), idFactory, nonceFactory = () => randomBytes(16).toString('hex'), env = {}, maxValidityDays = 90, challengeTtlMs = 10 * 60_000, maxSignAttempts = 5, codeReuseWindowMs = 120_000 }) {
    if (!store || !stepUp || typeof stepUp.verify !== 'function' || !accounts || typeof idFactory !== 'function') throw new MandateError('CONFIG', 'MandateService needs store, stepUp, signer, accounts and idFactory');
    assertSigner(signer);
    this.#s = store; this.#stepUp = stepUp; this.#signer = signer; this.#accounts = accounts; this.#strategies = strategies;
    this.#kill = killSwitches; this.#clock = clock; this.#ids = idFactory; this.#nonce = nonceFactory; this.#env = env;
    this.#o = { maxValidityMs: maxValidityDays * DAY, challengeTtlMs, maxSignAttempts, codeReuseWindowMs };
  }

  #now() { return this.#clock().getTime(); }
  #autonomousLocked() { return !isTradingFlagEnabled('AUTONOMOUS_MODE', this.#env); }

  async propose({ actor, principalId, draft, supersedes = null }) {
    if (!isUser(actor) || actor.principalId !== principalId) throw new MandateError('FORBIDDEN', 'only the owning user can propose a mandate (never an admin or an agent)');
    if (!draft || typeof draft !== 'object') throw new MandateError('INVALID', 'draft required');
    const extra = Object.keys(draft).filter((k) => !DRAFT_FIELDS.includes(k));
    if (extra.length) throw new MandateError('INVALID', `unexpected draft field(s): ${extra.join(', ')}`);
    if (draft.mode === 'C' && this.#autonomousLocked()) throw new MandateError('LOCKED_MODE', 'mode C (autonomous) is unavailable while AUTONOMOUS_MODE is locked');
    const account = await this.#accounts.get(draft.brokerAccountId);
    if (!account || account.principalId !== principalId) throw new MandateError('NOT_FOUND', 'broker account not found');
    if (account.status !== 'active') throw new MandateError('INVALID', `broker account is ${account.status}`);
    if (account.environment !== draft.environment) throw new MandateError('INVALID', `broker account is ${account.environment}, mandate is ${draft.environment}`);
    if (draft.strategy) {
      if (!this.#strategies) throw new MandateError('CONFIG', 'strategy binding needs a strategies port');
      const v = await this.#strategies.getVersion(draft.strategy.versionId);
      if (!v || v.strategyId !== draft.strategy.strategyId || v.definitionHash !== draft.strategy.definitionHash) throw new MandateError('INVALID', 'strategy binding does not match the stored strategy version');
    }
    const now = this.#now();
    if (draft.validFrom !== undefined && Date.parse(draft.validFrom) < now - 60_000) throw new MandateError('INVALID', 'validFrom cannot be in the past');

    return this.#s.withPrincipalLock(principalId, async (tx) => {
      let lineageId = `mdl_${randomBytes(12).toString('hex')}`;
      let version = 1;
      if (supersedes !== null) {
        const prev = await tx.getMandate(supersedes);
        if (!prev || prev.principalId !== principalId) throw new MandateError('NOT_FOUND', 'mandate to supersede not found');
        if (prev.status !== 'active') throw new MandateError('CONFLICT', `only an active mandate can be superseded (it is ${prev.status})`);
        lineageId = prev.lineageId;
        version = (await tx.latestVersionInLineage(lineageId)) + 1;
      }
      const nonce = this.#nonce();
      const { terms, hash } = defineTerms({
        schema: MANDATE_TERMS_TAG, lineageId, version, supersedes, principalId,
        brokerAccountId: draft.brokerAccountId, venue: account.broker, environment: draft.environment, mode: draft.mode,
        strategy: draft.strategy ?? null, instruments: draft.instruments, limits: draft.limits,
        validFrom: draft.validFrom ?? new Date(now).toISOString(), validUntil: draft.validUntil, nonce,
      }, { maxValidityMs: this.#o.maxValidityMs });
      const id = this.#ids('mdt');
      const at = new Date(now).toISOString();
      const expiresAt = new Date(now + this.#o.challengeTtlMs).toISOString();
      await tx.insertMandate({
        id, principalId, brokerAccountId: terms.brokerAccountId, strategyId: terms.strategy?.strategyId ?? null,
        mode021: MODE_TO_021[terms.mode], modeCode: terms.mode, status: 'draft',
        maxNotionalMinor: terms.limits.maxOrderNotionalMinor, currency: terms.limits.currency, decimals: terms.limits.decimals,
        validFrom: terms.validFrom, validUntil: terms.validUntil, createdAt: at,
        lineageId, version, supersedesId: supersedes, environment: terms.environment, terms, termsHash: hash,
        signNonce: nonce, signNonceExpiresAt: expiresAt, signAttempts: 0,
      });
      await tx.appendAudit(this.#audit(actor, principalId, 'mandate.proposed', id, { termsHash: hash, lineageId, version, mode: terms.mode, supersedes }, at));
      return Object.freeze({ mandateId: id, termsHash: hash, nonce, challenge: signingChallenge({ mandateId: id, termsHash: hash, nonce }), challengeExpiresAt: expiresAt, terms });
    });
  }

  /**
   * Sign a proposed mandate. The client echoes the termsHash and nonce the user was shown.
   * Order: ownership → replay (state, nonce) → challenge expiry → hash → attempts → mode lock →
   * step-up availability → code reuse → step-up → attest + activate (+ supersede).
   */
  async sign({ actor, mandateId, termsHash, nonce, code, request = {} }) {
    if (!isUser(actor)) throw new MandateError('FORBIDDEN', 'only the owning user can sign a mandate');
    const outcome = await this.#s.withPrincipalLock(actor.principalId, async (tx) => {
      const m = await tx.getMandate(mandateId);
      if (!m || m.principalId !== actor.principalId) return { error: new MandateError('NOT_FOUND', 'mandate not found') };
      if (m.status !== 'draft') return { error: new MandateError('REPLAY', `mandate is already ${m.status}; a signing request cannot be replayed`) };
      if (nonce !== m.signNonce) return { error: new MandateError('REPLAY', 'nonce does not match this proposal') };
      const now = this.#now();
      if (now > Date.parse(m.signNonceExpiresAt)) return { error: new MandateError('CHALLENGE_EXPIRED', 'signing challenge expired; propose again') };
      if (termsHash !== m.termsHash) return { error: new MandateError('HASH_MISMATCH', 'the signed hash is not the hash of these terms') };
      if (hashTerms(m.terms) !== m.termsHash) return { error: new MandateError('HASH_MISMATCH', 'stored terms no longer match their hash') };
      if (m.signAttempts >= this.#o.maxSignAttempts) return { error: new MandateError('ATTEMPTS_EXCEEDED', 'too many failed step-up attempts; propose again') };
      if (m.modeCode === 'C' && this.#autonomousLocked()) return { error: new MandateError('LOCKED_MODE', 'mode C is unavailable while AUTONOMOUS_MODE is locked') };
      const at = new Date(now).toISOString();

      const avail = this.#stepUp.availability ? await this.#stepUp.availability({ principalId: actor.principalId, request }) : { available: true };
      if (!avail.available) return { error: new MandateError('STEP_UP_UNAVAILABLE', 'enable two-factor authentication (TOTP) in account settings to sign mandates') };
      const fp = stepUpFingerprint(this.#signer, actor.principalId, String(code));
      if (await tx.recentStepUp(actor.principalId, fp, new Date(now - this.#o.codeReuseWindowMs).toISOString())) {
        return { error: new MandateError('REPLAY', 'this step-up code was already used; wait for the next code') };
      }
      const v = await this.#stepUp.verify({ principalId: actor.principalId, code, request });
      if (!v?.ok) {
        const attempts = m.signAttempts + 1;
        const exhausted = attempts >= this.#o.maxSignAttempts;
        await tx.updateMandate(mandateId, exhausted ? { signAttempts: attempts, status: 'revoked', revokedAt: at, revocationReason: 'signing_attempts_exceeded' } : { signAttempts: attempts }, 'draft');
        await tx.appendAudit(this.#audit(actor, m.principalId, 'mandate.sign_failed', mandateId, { attempts, reason: v?.reason ?? 'unknown', exhausted }, at));
        return { error: new MandateError(exhausted ? 'ATTEMPTS_EXCEEDED' : 'STEP_UP_FAILED', exhausted ? 'too many failed step-up attempts; the proposal was voided' : 'step-up verification failed') };
      }

      const statement = { mandateId, termsHash: m.termsHash, nonce: m.signNonce, signer: actor.principalId, method: v.method, signedAt: at };
      const signature = signMandate(this.#signer, statement);
      let superseded = null;
      if (m.supersedesId) {
        const prev = await tx.getMandate(m.supersedesId);
        if (!prev || prev.status !== 'active') return { error: new MandateError('CONFLICT', 'the mandate this version supersedes is no longer active') };
        await tx.updateMandate(prev.id, { status: 'revoked', revokedAt: at, revocationReason: `superseded_by:${mandateId}` }, 'active');
        const orders = await tx.cancelOpenOrders(prev.id, { actor: actorLabel(actor), reason: 'mandate superseded', at });
        await tx.appendAudit(this.#audit(actor, m.principalId, 'mandate.superseded', prev.id, { by: mandateId, orders }, at));
        superseded = prev.id;
      }
      await tx.updateMandate(mandateId, {
        status: 'active', approvedAt: at, approvedBy: actor.principalId, stepUpMethod: v.method,
        signature, signedAt: at, signatureKeyId: this.#signer.keyId,
      }, 'draft');
      await tx.appendAudit(this.#audit(actor, m.principalId, 'mandate.signed', mandateId, { termsHash: m.termsHash, method: v.method, keyId: this.#signer.keyId, stepUpFingerprint: fp, superseded }, at));
      return { result: Object.freeze({ mandateId, status: 'active', signedAt: at, method: v.method, superseded }) };
    });
    if (outcome.error) throw outcome.error; // thrown after commit, so failed attempts are persisted
    return outcome.result;
  }

  async revoke({ actor, mandateId, reason }) {
    assertReason(reason);
    if (actor?.kind === 'agent') throw new MandateError('FORBIDDEN', 'agents can never revoke mandates');
    const m0 = await this.#s.getMandate(mandateId);
    if (!m0) throw new MandateError('NOT_FOUND', 'mandate not found');
    const owner = isUser(actor) && actor.principalId === m0.principalId;
    if (!owner && !isAdmin(actor) && !isPlatform(actor)) throw new MandateError(isUser(actor) ? 'NOT_FOUND' : 'FORBIDDEN', isUser(actor) ? 'mandate not found' : 'not allowed to revoke');
    return this.#s.withPrincipalLock(m0.principalId, (tx) => this.#revokeIn(tx, actor, mandateId, reason));
  }

  async #revokeIn(tx, actor, mandateId, reason) {
    const m = await tx.getMandate(mandateId);
    if (m.status !== 'active' && m.status !== 'draft') throw new MandateError('CONFLICT', `mandate is already ${m.status}`);
    const at = new Date(this.#now()).toISOString();
    await tx.updateMandate(mandateId, { status: 'revoked', revokedAt: at, revocationReason: reason }, m.status);
    const orders = await tx.cancelOpenOrders(mandateId, { actor: actorLabel(actor), reason: `mandate revoked: ${reason}`, at });
    await tx.appendAudit(this.#audit(actor, m.principalId, 'mandate.revoked', mandateId, { reason, from: m.status, orders }, at));
    return Object.freeze({ mandateId, status: 'revoked', orders });
  }

  /** Halt first (kill switch), then revoke every live or pending mandate of the principal. */
  async emergencyShutdown({ actor, principalId = null, reason }) {
    assertReason(reason);
    if (!this.#kill) throw new MandateError('CONFIG', 'emergencyShutdown needs the Stage 15 KillSwitchService');
    if (actor?.kind === 'agent') throw new MandateError('FORBIDDEN', 'agents can never trigger or undo a shutdown');
    const at = new Date(this.#now()).toISOString();
    if (principalId === null) {
      if (!isAdmin(actor)) throw new MandateError('FORBIDDEN', 'a platform-wide shutdown needs an admin');
      await this.#kill.engage({ actor, scopeType: 'global', reason: `emergency shutdown: ${reason}` });
      await this.#s.appendAudit(this.#audit(actor, null, 'mandate.emergency_shutdown', 'global', { scope: 'global', reason }, at));
      return Object.freeze({ scope: 'global', killSwitch: 'engaged', revoked: [] });
    }
    const owner = isUser(actor) && actor.principalId === principalId;
    if (!owner && !isAdmin(actor) && !isPlatform(actor)) throw new MandateError('FORBIDDEN', 'not allowed to shut down this principal');
    await this.#kill.engage({ actor, scopeType: 'principal', scopeId: principalId, principalId, reason: `emergency shutdown: ${reason}` });
    const revoked = await this.#s.withPrincipalLock(principalId, async (tx) => {
      const live = await tx.listMandates({ principalId, statuses: ['active', 'draft'] });
      const out = [];
      for (const m of live) out.push(await this.#revokeIn(tx, actor, m.id, `emergency shutdown: ${reason}`));
      await tx.appendAudit(this.#audit(actor, principalId, 'mandate.emergency_shutdown', principalId, { scope: 'principal', reason, revoked: out.map((r) => r.mandateId) }, at));
      return out;
    });
    return Object.freeze({ scope: 'principal', killSwitch: 'engaged', revoked: revoked.map((r) => r.mandateId) });
  }

  /** Expire every active mandate whose window has ended (idempotent; for a scheduler). */
  async expireDue() {
    const now = this.#now();
    const at = new Date(now).toISOString();
    const due = await this.#s.listExpired(at);
    const system = { principalId: 'prn_system', kind: 'platform' };
    const expired = [];
    for (const m of due) {
      await this.#s.withPrincipalLock(m.principalId, async (tx) => {
        const cur = await tx.getMandate(m.id);
        if (cur.status !== 'active' || Date.parse(cur.validUntil) > now) return;
        await tx.updateMandate(m.id, { status: 'expired' }, 'active');
        const orders = await tx.cancelOpenOrders(m.id, { actor: 'system', reason: 'mandate expired', at });
        await tx.appendAudit(this.#audit(system, m.principalId, 'mandate.expired', m.id, { validUntil: cur.validUntil, orders }, at));
        expired.push(m.id);
      });
    }
    return expired;
  }

  /**
   * The mandate as the risk engine may trust it (Stage 15 ctx.mandate), or a refusal.
   * Fail closed: integrity, row/terms consistency, state, signature, window, mode lock.
   */
  async verifyForOrder(mandateId) {
    const m = await this.#s.getMandate(mandateId);
    if (!m) throw new MandateError('NOT_FOUND', 'mandate not found');
    if (!m.terms || hashTerms(m.terms) !== m.termsHash) throw new MandateError('HASH_MISMATCH', 'mandate terms do not match their hash');
    const t = m.terms;
    const consistent = t.principalId === m.principalId && t.brokerAccountId === m.brokerAccountId && (t.strategy?.strategyId ?? null) === m.strategyId
      && MODE_TO_021[t.mode] === m.mode021 && t.mode === m.modeCode && t.limits.maxOrderNotionalMinor === m.maxNotionalMinor
      && t.limits.currency === m.currency && t.limits.decimals === m.decimals && Date.parse(t.validFrom) === Date.parse(m.validFrom)
      && Date.parse(t.validUntil) === Date.parse(m.validUntil) && t.environment === m.environment;
    if (!consistent) throw new MandateError('HASH_MISMATCH', 'mandate row differs from its signed terms');
    if (m.status === 'revoked') throw new MandateError('REVOKED', `mandate revoked (${m.revocationReason})`);
    if (m.status === 'expired') throw new MandateError('EXPIRED', 'mandate expired');
    if (m.status !== 'active') throw new MandateError('NOT_ACTIVE', `mandate is ${m.status}`);
    const statement = { mandateId: m.id, termsHash: m.termsHash, nonce: t.nonce, signer: m.approvedBy, method: m.stepUpMethod, signedAt: m.signedAt };
    if (m.approvedBy !== m.principalId || !verifyMandateSignature(this.#signer, statement, m.signature, m.signatureKeyId)) throw new MandateError('SIGNATURE_INVALID', 'mandate signature does not verify');
    const now = this.#now();
    if (now < Date.parse(m.validFrom)) throw new MandateError('NOT_YET_VALID', 'mandate is not valid yet');
    if (now >= Date.parse(m.validUntil)) throw new MandateError('EXPIRED', 'mandate validity window has ended');
    if (m.modeCode === 'C' && this.#autonomousLocked()) throw new MandateError('LOCKED_MODE', 'mode C mandates are unusable while AUTONOMOUS_MODE is locked');
    return Object.freeze({
      id: m.id, principalId: m.principalId, brokerAccountId: m.brokerAccountId, strategyId: m.strategyId, mode: m.mode021, modeCode: m.modeCode,
      status: m.status, maxNotionalMinor: m.maxNotionalMinor, currency: m.currency, decimals: m.decimals,
      validFrom: Date.parse(m.validFrom), validUntil: Date.parse(m.validUntil), approvedAt: Date.parse(m.approvedAt), stepUpMethod: m.stepUpMethod,
      termsHash: m.termsHash, environment: m.environment, instruments: [...t.instruments], maxDailyNotionalMinor: t.limits.maxDailyNotionalMinor,
      strategyVersionId: t.strategy?.versionId ?? null,
    });
  }

  #audit(actor, principalId, action, targetId, payload, at) {
    return { occurredAt: at, actorType: actor?.kind === 'platform' ? 'system' : actorType(actor), actorId: actor?.principalId ?? 'system', principalId, action, targetType: 'mandate', targetId, payload };
  }
}

function assertReason(reason) {
  if (typeof reason !== 'string' || reason.trim().length === 0 || reason.length > 500) throw new MandateError('INVALID', 'reason (1–500 chars) required');
}
