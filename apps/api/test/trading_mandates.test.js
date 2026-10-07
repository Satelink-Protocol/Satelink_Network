import { expect } from 'chai';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MandateService, InMemoryMandateStore, createBetterAuthTotpVerifier, signingChallenge, hashTerms, MandateError,
} from '../src/trading_agent/authorization/index.mjs';
import { InMemoryRiskStore, KillSwitchService, CHECKS, activeKillSwitchesFor } from '../src/trading_agent/risk/index.mjs';
import { tradingFlagEnvName as F } from '../src/trading_agent/flags.mjs';

// Stage 16 — user-signed mandates. Pure: no network, no DB, no process.env.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const AUTHZ_DIR = path.resolve(HERE, '../src/trading_agent/authorization');
const T0 = Date.UTC(2026, 9, 5, 12, 0);
const DAY = 86_400_000;
const alice = { principalId: 'prn_alice', kind: 'human', role: 'user' };
const bob = { principalId: 'prn_bob', kind: 'human', role: 'user' };
const admin = { principalId: 'prn_ops', kind: 'human', role: 'admin' };
const agent = { principalId: 'prn_bot', kind: 'agent' };
const platform = { principalId: 'prn_risk', kind: 'platform' };
const GOOD = '123456';
const STV_HASH = `sha256:${'c'.repeat(64)}`;

const DRAFT = (over = {}) => ({
  brokerAccountId: 'bka_1', environment: 'paper', mode: 'A', strategy: null, instruments: ['BTC-USDT'],
  limits: { currency: 'USDT', decimals: 2, maxOrderNotionalMinor: '100000', maxDailyNotionalMinor: '500000' },
  validUntil: new Date(T0 + 30 * DAY).toISOString(), ...over,
});

function setup({ env = {}, available = true } = {}) {
  let now = T0;
  let n = 0;
  let nonce = 0;
  const store = new InMemoryMandateStore();
  const riskStore = new InMemoryRiskStore();
  const calls = [];
  const stepUp = {
    async availability() { return { available }; },
    async verify({ code }) { calls.push(code); return code === GOOD || code === '654321' ? { ok: true, method: 'totp', userId: 'u_alice' } : { ok: false, reason: 'invalid_code' }; },
  };
  const accounts = { async get(id) { return { bka_1: { id: 'bka_1', principalId: 'prn_alice', broker: 'binance', environment: 'paper', status: 'active' }, bka_live: { id: 'bka_live', principalId: 'prn_alice', broker: 'binance', environment: 'live', status: 'active' }, bka_off: { id: 'bka_off', principalId: 'prn_alice', broker: 'binance', environment: 'paper', status: 'suspended' }, bka_bob: { id: 'bka_bob', principalId: 'prn_bob', broker: 'binance', environment: 'paper', status: 'active' } }[id] ?? null; } };
  const strategies = { async getVersion(id) { return id === 'stv_1' ? { strategyId: 'stg_1', definitionHash: STV_HASH } : null; } };
  const clock = () => new Date(now);
  const signer = { keyId: 'test-k1', secret: Buffer.alloc(32, 7) };
  const svc = new MandateService({
    store, stepUp, signer, accounts, strategies, killSwitches: new KillSwitchService({ store: riskStore, clock }), clock,
    idFactory: (p) => `${p}_${String(++n).padStart(4, '0')}`, nonceFactory: () => (++nonce).toString(16).padStart(32, '0'), env,
  });
  return { svc, store, riskStore, calls, signer, advance: (ms) => { now += ms; }, at: () => now, accounts, stepUp, strategies, clock };
}
const code = (p) => p.then(() => null, (e) => { if (!(e instanceof MandateError)) throw e; return e.code; });
async function signed(ctx, draft = DRAFT(), c = GOOD) {
  const p = await ctx.svc.propose({ actor: alice, principalId: 'prn_alice', draft });
  await ctx.svc.sign({ actor: alice, mandateId: p.mandateId, termsHash: p.termsHash, nonce: p.nonce, code: c });
  return p;
}

describe('mandates: propose → sign → verify', () => {
  it('a signed mandate verifies for orders and satisfies Stage 15 check 7', async () => {
    const ctx = setup();
    const p = await ctx.svc.propose({ actor: alice, principalId: 'prn_alice', draft: DRAFT() });
    expect(p.mandateId).to.equal('mdt_0001');
    expect(p.termsHash).to.equal(hashTerms(p.terms));
    expect(p.challenge).to.equal(signingChallenge({ mandateId: p.mandateId, termsHash: p.termsHash, nonce: p.nonce }));
    expect(p.terms).to.deep.include({ principalId: 'prn_alice', venue: 'binance', version: 1, supersedes: null, mode: 'A', nonce: p.nonce });
    expect((await ctx.store.getMandate(p.mandateId)).status).to.equal('draft');
    expect(await code(ctx.svc.verifyForOrder(p.mandateId))).to.equal('NOT_ACTIVE');
    const s = await ctx.svc.sign({ actor: alice, mandateId: p.mandateId, termsHash: p.termsHash, nonce: p.nonce, code: GOOD });
    expect(s).to.deep.include({ status: 'active', method: 'totp' });
    const view = await ctx.svc.verifyForOrder(p.mandateId);
    expect(view).to.deep.include({ id: 'mdt_0001', mode: 'copilot', modeCode: 'A', status: 'active', stepUpMethod: 'totp', maxNotionalMinor: '100000', termsHash: p.termsHash });
    const check7 = CHECKS.find((c) => c.id === 'mandate').fn;
    const order = { principalId: 'prn_alice', mandateId: view.id, brokerAccountId: 'bka_1', approvedBy: 'prn_alice' };
    expect(check7(order, { now: T0 + 1000, mandate: view, policy: { currency: 'USDT' } })).to.deep.equal({ ok: true });
    expect(check7({ ...order, approvedBy: undefined }, { now: T0 + 1000, mandate: view, policy: { currency: 'USDT' } }).code).to.equal('APPROVAL_REQUIRED'); // mode A = per-order approval
    expect(ctx.store.audit.map((a) => a.action)).to.deep.equal(['mandate.proposed', 'mandate.signed']);
    expect(ctx.store.audit[1].payload).to.include.keys('termsHash', 'method', 'keyId', 'stepUpFingerprint');
    expect(JSON.stringify(ctx.store.audit)).to.not.include(GOOD); // the code itself is never stored
  });

  it('canonical hash: identical terms hash identically; any change of signed content changes the hash', async () => {
    const a = setup();
    const b = setup();
    const pa = await a.svc.propose({ actor: alice, principalId: 'prn_alice', draft: DRAFT() });
    const pb = await b.svc.propose({ actor: alice, principalId: 'prn_alice', draft: { ...DRAFT(), limits: { maxDailyNotionalMinor: '500000', maxOrderNotionalMinor: '100000', decimals: 2, currency: 'USDT' } } });
    expect({ ...pa.terms, lineageId: 0 }).to.deep.equal({ ...pb.terms, lineageId: 0 });
    expect(hashTerms({ ...pa.terms, lineageId: pb.terms.lineageId })).to.equal(pb.termsHash);
    expect(hashTerms({ ...pa.terms, instruments: ['ETH-USDT'] })).to.not.equal(pa.termsHash);
    expect(hashTerms({ ...pa.terms, nonce: 'f'.repeat(32) })).to.not.equal(pa.termsHash);
  });
});

describe('mandates: required rejects (expired / revoked / hash mismatch / replay)', () => {
  it('expired: a mandate past validUntil is refused, and expireDue marks it expired and cancels its orders', async () => {
    const ctx = setup();
    const p = await signed(ctx, DRAFT({ validUntil: new Date(T0 + DAY).toISOString() }));
    ctx.store.orders.push({ id: 'ord_1', mandateId: p.mandateId, status: 'approved' });
    ctx.advance(DAY);
    expect(await code(ctx.svc.verifyForOrder(p.mandateId))).to.equal('EXPIRED'); // even before the expiry job ran
    expect(await ctx.svc.expireDue()).to.deep.equal([p.mandateId]);
    expect(await ctx.svc.expireDue()).to.deep.equal([]); // idempotent
    expect(await code(ctx.svc.verifyForOrder(p.mandateId))).to.equal('EXPIRED');
    expect(ctx.store.orders[0].status).to.equal('cancelled');
    expect(await code(ctx.svc.revoke({ actor: alice, mandateId: p.mandateId, reason: 'x' }))).to.equal('CONFLICT');
  });

  it('expired: an unsigned challenge expires; not-yet-valid mandates are refused', async () => {
    const ctx = setup();
    const p = await ctx.svc.propose({ actor: alice, principalId: 'prn_alice', draft: DRAFT() });
    ctx.advance(10 * 60_000 + 1);
    expect(await code(ctx.svc.sign({ actor: alice, mandateId: p.mandateId, termsHash: p.termsHash, nonce: p.nonce, code: GOOD }))).to.equal('CHALLENGE_EXPIRED');
    const later = await signed(ctx, DRAFT({ validFrom: new Date(ctx.at() + DAY).toISOString(), validUntil: new Date(ctx.at() + 2 * DAY).toISOString() }));
    expect(await code(ctx.svc.verifyForOrder(later.mandateId))).to.equal('NOT_YET_VALID');
  });

  it('revoked: revocation refuses the mandate and cancels its future orders', async () => {
    const ctx = setup();
    const p = await signed(ctx);
    const statuses = ['proposed', 'approved', 'submitted', 'acknowledged', 'partially_filled', 'filled', 'cancelled', 'rejected'];
    statuses.forEach((s, i) => ctx.store.orders.push({ id: `ord_${i}`, mandateId: p.mandateId, status: s }));
    ctx.store.orders.push({ id: 'ord_other', mandateId: 'mdt_other', status: 'approved' });
    const r = await ctx.svc.revoke({ actor: alice, mandateId: p.mandateId, reason: 'changed my mind' });
    expect(r.orders).to.deep.equal({ cancelled: 2, cancelRequested: 3 });
    expect(ctx.store.orders.map((o) => o.status)).to.deep.equal(['cancelled', 'cancelled', 'cancel_requested', 'cancel_requested', 'cancel_requested', 'filled', 'cancelled', 'rejected', 'approved']);
    expect(ctx.store.orderEvents).to.have.length(5);
    expect(ctx.store.orderEvents[0]).to.deep.include({ eventType: 'mandate_cancel', fromStatus: 'proposed', toStatus: 'cancelled', actor: 'user:prn_alice' });
    expect(await code(ctx.svc.verifyForOrder(p.mandateId))).to.equal('REVOKED');
    expect(await code(ctx.svc.revoke({ actor: alice, mandateId: p.mandateId, reason: 'again' }))).to.equal('CONFLICT');
  });

  it('hash mismatch: a signature over other terms, tampered stored terms, a drifted row or a forged signature are refused', async () => {
    const ctx = setup();
    const p = await ctx.svc.propose({ actor: alice, principalId: 'prn_alice', draft: DRAFT() });
    expect(await code(ctx.svc.sign({ actor: alice, mandateId: p.mandateId, termsHash: `sha256:${'0'.repeat(64)}`, nonce: p.nonce, code: GOOD }))).to.equal('HASH_MISMATCH');
    ctx.store.mandates.get(p.mandateId).terms.limits.maxOrderNotionalMinor = '999999999'; // tampered at rest
    expect(await code(ctx.svc.sign({ actor: alice, mandateId: p.mandateId, termsHash: p.termsHash, nonce: p.nonce, code: GOOD }))).to.equal('HASH_MISMATCH');
    expect(ctx.calls).to.deep.equal([]); // never asked for step-up on a mismatching document

    const q = await signed(ctx);
    ctx.store.mandates.get(q.mandateId).maxNotionalMinor = '999999999'; // row drifts from its signed terms
    expect(await code(ctx.svc.verifyForOrder(q.mandateId))).to.equal('HASH_MISMATCH');
    const r = await signed(ctx, DRAFT(), '654321');
    ctx.store.mandates.get(r.mandateId).signature = `hmac-sha256:${'0'.repeat(64)}`;
    expect(await code(ctx.svc.verifyForOrder(r.mandateId))).to.equal('SIGNATURE_INVALID');
    const other = setup();
    const s = await signed(other);
    const foreign = new MandateService({ store: other.store, stepUp: other.stepUp, signer: { keyId: 'test-k1', secret: Buffer.alloc(32, 9) }, accounts: other.accounts, idFactory: (x) => x, clock: other.clock });
    expect(await code(foreign.verifyForOrder(s.mandateId))).to.equal('SIGNATURE_INVALID'); // wrong key
  });

  it('replay: a used signing request, a wrong nonce and a reused step-up code are refused', async () => {
    const ctx = setup();
    const p = await ctx.svc.propose({ actor: alice, principalId: 'prn_alice', draft: DRAFT() });
    expect(await code(ctx.svc.sign({ actor: alice, mandateId: p.mandateId, termsHash: p.termsHash, nonce: 'f'.repeat(32), code: GOOD }))).to.equal('REPLAY');
    const req = { actor: alice, mandateId: p.mandateId, termsHash: p.termsHash, nonce: p.nonce, code: GOOD };
    await ctx.svc.sign(req);
    expect(await code(ctx.svc.sign(req))).to.equal('REPLAY'); // exact replay of a successful request
    const q = await ctx.svc.propose({ actor: alice, principalId: 'prn_alice', draft: DRAFT({ instruments: ['ETH-USDT'] }) });
    const before = ctx.calls.length;
    expect(await code(ctx.svc.sign({ actor: alice, mandateId: q.mandateId, termsHash: q.termsHash, nonce: q.nonce, code: GOOD }))).to.equal('REPLAY'); // same TOTP code, second mandate
    expect(ctx.calls.length).to.equal(before); // refused before verification
    expect(await code(ctx.svc.sign({ actor: alice, mandateId: q.mandateId, termsHash: q.termsHash, nonce: p.nonce, code: '654321' }))).to.equal('REPLAY'); // nonce of another proposal
    ctx.advance(121_000);
    const q2 = await ctx.svc.propose({ actor: alice, principalId: 'prn_alice', draft: DRAFT({ instruments: ['ETH-USDT'] }) });
    expect((await ctx.svc.sign({ actor: alice, mandateId: q2.mandateId, termsHash: q2.termsHash, nonce: q2.nonce, code: GOOD })).status).to.equal('active');
  });
});

describe('mandates: step-up', () => {
  it('failed attempts persist; the 5th voids the proposal', async () => {
    const ctx = setup();
    const p = await ctx.svc.propose({ actor: alice, principalId: 'prn_alice', draft: DRAFT() });
    const tryCode = (c) => code(ctx.svc.sign({ actor: alice, mandateId: p.mandateId, termsHash: p.termsHash, nonce: p.nonce, code: c }));
    for (let i = 0; i < 4; i += 1) expect(await tryCode(`00000${i}`)).to.equal('STEP_UP_FAILED');
    expect((await ctx.store.getMandate(p.mandateId)).signAttempts).to.equal(4);
    expect(await tryCode('000009')).to.equal('ATTEMPTS_EXCEEDED');
    const m = await ctx.store.getMandate(p.mandateId);
    expect([m.status, m.revocationReason]).to.deep.equal(['revoked', 'signing_attempts_exceeded']);
    expect(await tryCode(GOOD)).to.equal('REPLAY');
    expect(ctx.store.audit.filter((a) => a.action === 'mandate.sign_failed')).to.have.length(5);
  });

  it('no enrolled factor → STEP_UP_UNAVAILABLE, without spending an attempt', async () => {
    const ctx = setup({ available: false });
    const p = await ctx.svc.propose({ actor: alice, principalId: 'prn_alice', draft: DRAFT() });
    expect(await code(ctx.svc.sign({ actor: alice, mandateId: p.mandateId, termsHash: p.termsHash, nonce: p.nonce, code: GOOD }))).to.equal('STEP_UP_UNAVAILABLE');
    expect((await ctx.store.getMandate(p.mandateId)).signAttempts).to.equal(0);
  });

  it('Better Auth TOTP adapter: verifies only for the principal\'s own 2FA-enabled session and never touches login state', async () => {
    const seen = [];
    let enabled = true;
    let userId = 'u_alice';
    const auth = {
      api: new Proxy({
        async getSession() { seen.push('getSession'); return { user: { id: userId, twoFactorEnabled: enabled }, session: { id: 's1', token: 't' } }; },
        async verifyTOTP({ body }) { seen.push('verifyTOTP'); if (body.code !== GOOD) throw new Error('UNAUTHORIZED'); return { token: 't', user: {} }; },
      }, { get(t, k) { if (!(k in t)) seen.push(`UNEXPECTED:${String(k)}`); return t[k]; } }),
    };
    const v = createBetterAuthTotpVerifier({ getAuth: async () => auth, authUserIdOf: async (p) => (p === 'prn_alice' ? 'u_alice' : null) });
    const request = { headers: { cookie: 'satelink.session_token=abc' } };
    expect(await v.verify({ principalId: 'prn_alice', code: GOOD, request })).to.deep.equal({ ok: true, method: 'totp', userId: 'u_alice' });
    expect(await v.verify({ principalId: 'prn_alice', code: '000000', request })).to.deep.equal({ ok: false, reason: 'invalid_code' });
    expect(await v.verify({ principalId: 'prn_alice', code: '12345', request })).to.deep.equal({ ok: false, reason: 'malformed_code' });
    userId = 'u_mallory';
    expect(await v.verify({ principalId: 'prn_alice', code: GOOD, request })).to.deep.equal({ ok: false, reason: 'no_session_for_principal' });
    userId = 'u_alice';
    enabled = false; // enrolment incomplete: verifyTOTP would FINISH enrolment and rotate the session — must never be called
    const callsBefore = seen.filter((x) => x === 'verifyTOTP').length;
    expect(await v.verify({ principalId: 'prn_alice', code: GOOD, request })).to.deep.equal({ ok: false, reason: 'two_factor_not_enabled' });
    expect(seen.filter((x) => x === 'verifyTOTP').length).to.equal(callsBefore);
    expect(await v.availability({ principalId: 'prn_alice', request })).to.deep.equal({ available: false, method: 'totp' });
    expect(seen.filter((x) => x.startsWith('UNEXPECTED'))).to.deep.equal([]); // only getSession + verifyTOTP are ever used
  });
});

describe('mandates: modes, validation and permissions', () => {
  it('mode C is refused while AUTONOMOUS_MODE is locked, even with the env flag set', async () => {
    const ctx = setup({ env: { [F('AUTONOMOUS_MODE')]: 'true', [F('TRADING_AGENT')]: 'true' } });
    expect(await code(ctx.svc.propose({ actor: alice, principalId: 'prn_alice', draft: DRAFT({ mode: 'C' }) }))).to.equal('LOCKED_MODE');
  });

  it('mode B binds a stored deterministic strategy version; mode A needs none', async () => {
    const ctx = setup();
    expect(await code(ctx.svc.propose({ actor: alice, principalId: 'prn_alice', draft: DRAFT({ mode: 'B' }) }))).to.equal('INVALID');
    expect(await code(ctx.svc.propose({ actor: alice, principalId: 'prn_alice', draft: DRAFT({ mode: 'B', strategy: { strategyId: 'stg_1', versionId: 'stv_1', definitionHash: `sha256:${'d'.repeat(64)}` } }) }))).to.equal('INVALID');
    const b = await signed(ctx, DRAFT({ mode: 'B', strategy: { strategyId: 'stg_1', versionId: 'stv_1', definitionHash: STV_HASH } }));
    expect(await ctx.svc.verifyForOrder(b.mandateId)).to.deep.include({ mode: 'automated', modeCode: 'B', strategyId: 'stg_1', strategyVersionId: 'stv_1' });
  });

  it('rejects malformed or unsafe drafts', async () => {
    const ctx = setup();
    const bad = [
      DRAFT({ leverage: 5 }), DRAFT({ validUntil: new Date(T0 + 91 * DAY).toISOString() }), DRAFT({ validFrom: new Date(T0 - 2 * 60_000).toISOString() }),
      DRAFT({ limits: { currency: 'USDT', decimals: 2, maxOrderNotionalMinor: '100', maxDailyNotionalMinor: '99' } }), DRAFT({ limits: { currency: 'USDT', decimals: 2, maxOrderNotionalMinor: 100, maxDailyNotionalMinor: '500' } }),
      DRAFT({ environment: 'live' }), DRAFT({ brokerAccountId: 'bka_off' }), DRAFT({ instruments: [] }), DRAFT({ mode: 'D' }), DRAFT({ validUntil: 'tomorrow' }),
    ];
    for (const d of bad) expect(await code(ctx.svc.propose({ actor: alice, principalId: 'prn_alice', draft: d })), JSON.stringify(d).slice(0, 80)).to.equal('INVALID');
    expect(await code(ctx.svc.propose({ actor: alice, principalId: 'prn_alice', draft: DRAFT({ brokerAccountId: 'bka_bob' }) }))).to.equal('NOT_FOUND');
  });

  it('only the owning user proposes and signs; agents never; admins and the platform may revoke', async () => {
    const ctx = setup();
    for (const a of [agent, admin, bob, platform, { ...agent, role: 'user' }]) {
      expect(await code(ctx.svc.propose({ actor: a, principalId: 'prn_alice', draft: DRAFT() })), JSON.stringify(a)).to.equal('FORBIDDEN');
    }
    const p = await ctx.svc.propose({ actor: alice, principalId: 'prn_alice', draft: DRAFT() });
    const req = { mandateId: p.mandateId, termsHash: p.termsHash, nonce: p.nonce, code: GOOD };
    expect(await code(ctx.svc.sign({ actor: agent, ...req }))).to.equal('FORBIDDEN');
    expect(await code(ctx.svc.sign({ actor: admin, ...req }))).to.equal('FORBIDDEN');
    expect(await code(ctx.svc.sign({ actor: bob, ...req }))).to.equal('NOT_FOUND');
    await ctx.svc.sign({ actor: alice, ...req });
    expect(await code(ctx.svc.revoke({ actor: agent, mandateId: p.mandateId, reason: 'x' }))).to.equal('FORBIDDEN');
    expect(await code(ctx.svc.revoke({ actor: bob, mandateId: p.mandateId, reason: 'x' }))).to.equal('NOT_FOUND');
    expect((await ctx.svc.revoke({ actor: platform, mandateId: p.mandateId, reason: 'risk breach' })).status).to.equal('revoked');
    const q = await signed(ctx, DRAFT(), '654321');
    expect((await ctx.svc.revoke({ actor: admin, mandateId: q.mandateId, reason: 'compliance' })).status).to.equal('revoked');
    expect(ctx.store.audit.find((a) => a.targetId === q.mandateId && a.action === 'mandate.revoked')).to.deep.include({ actorType: 'staff', actorId: 'prn_ops' });
  });
});

describe('mandates: versioning and emergency shutdown', () => {
  it('a new version supersedes the old one only when signed; the old one\'s open orders are cancelled', async () => {
    const ctx = setup();
    const v1 = await signed(ctx);
    ctx.store.orders.push({ id: 'ord_v1', mandateId: v1.mandateId, status: 'approved' });
    const v2 = await ctx.svc.propose({ actor: alice, principalId: 'prn_alice', supersedes: v1.mandateId, draft: DRAFT({ limits: { currency: 'USDT', decimals: 2, maxOrderNotionalMinor: '50000', maxDailyNotionalMinor: '200000' } }) });
    expect(v2.terms).to.deep.include({ lineageId: v1.terms.lineageId, version: 2, supersedes: v1.mandateId });
    expect((await ctx.svc.verifyForOrder(v1.mandateId)).status).to.equal('active'); // still active until v2 is signed
    ctx.advance(121_000);
    expect((await ctx.svc.sign({ actor: alice, mandateId: v2.mandateId, termsHash: v2.termsHash, nonce: v2.nonce, code: GOOD })).superseded).to.equal(v1.mandateId);
    expect(await code(ctx.svc.verifyForOrder(v1.mandateId))).to.equal('REVOKED');
    expect((await ctx.store.getMandate(v1.mandateId)).revocationReason).to.equal(`superseded_by:${v2.mandateId}`);
    expect(ctx.store.orders[0].status).to.equal('cancelled');
    expect((await ctx.svc.verifyForOrder(v2.mandateId)).maxNotionalMinor).to.equal('50000');
    const v3 = await ctx.svc.propose({ actor: alice, principalId: 'prn_alice', supersedes: v2.mandateId, draft: DRAFT() });
    expect(v3.terms.version).to.equal(3);
    expect(await code(ctx.svc.propose({ actor: alice, principalId: 'prn_alice', supersedes: v3.mandateId, draft: DRAFT() }))).to.equal('CONFLICT'); // only active mandates can be superseded
    expect(await code(ctx.svc.propose({ actor: alice, principalId: 'prn_alice', supersedes: v1.mandateId, draft: DRAFT() }))).to.equal('CONFLICT');
  });

  it('emergency shutdown halts first (principal kill switch), then revokes everything and cancels orders', async () => {
    const ctx = setup();
    const a = await signed(ctx);
    const b = await ctx.svc.propose({ actor: alice, principalId: 'prn_alice', draft: DRAFT({ instruments: ['ETH-USDT'] }) }); // still a draft
    ctx.store.orders.push({ id: 'ord_a', mandateId: a.mandateId, status: 'submitted' });
    expect(await code(ctx.svc.emergencyShutdown({ actor: agent, principalId: 'prn_alice', reason: 'x' }))).to.equal('FORBIDDEN');
    expect(await code(ctx.svc.emergencyShutdown({ actor: bob, principalId: 'prn_alice', reason: 'x' }))).to.equal('FORBIDDEN');
    expect(await code(ctx.svc.emergencyShutdown({ actor: alice, reason: 'x' }))).to.equal('FORBIDDEN'); // global needs an admin
    const r = await ctx.svc.emergencyShutdown({ actor: alice, principalId: 'prn_alice', reason: 'something is wrong' });
    expect(r).to.deep.equal({ scope: 'principal', killSwitch: 'engaged', revoked: [a.mandateId, b.mandateId] });
    expect(ctx.store.orders[0].status).to.equal('cancel_requested');
    const order = { principalId: 'prn_alice', brokerAccountId: 'bka_1', mandateId: a.mandateId, strategyId: null, venue: 'binance', instrument: 'BTC-USDT' };
    expect(activeKillSwitchesFor(ctx.riskStore.killSwitches, order).map((e) => e.scopeType)).to.deep.equal(['principal']); // Stage 15 check 1 now stops everything
    const g = await ctx.svc.emergencyShutdown({ actor: admin, reason: 'venue incident' });
    expect(g.scope).to.equal('global');
    expect(activeKillSwitchesFor(ctx.riskStore.killSwitches, { ...order, principalId: 'prn_bob' }).map((e) => e.scopeType)).to.deep.equal(['global']);
  });
});

describe('mandates: isolation (static)', () => {
  it('authorization/** never imports login code, sessions or process.env; it reaches Better Auth only through an injected getter', () => {
    for (const f of fs.readdirSync(AUTHZ_DIR).filter((x) => x.endsWith('.mjs'))) {
      const src = fs.readFileSync(path.join(AUTHZ_DIR, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      const specs = [...src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const s of specs) expect(s, `${f} → ${s}`).to.not.match(/auth\/|better-auth|express|cookie|session|agent\/|ai_gateway|^(pg|ioredis|redis|node:http|node:https|node:fs|node:child_process)$/);
      expect(src, f).to.not.match(/process\.env|Math\.random|fetch\(/);
    }
  });
});
