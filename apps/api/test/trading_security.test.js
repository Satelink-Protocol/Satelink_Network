import { expect } from 'chai';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  sealSecret, openSecret, LocalDevKeyProvider, AwsKmsKeyProvider, signV4, keyProviderFromConfig,
  egressConfig, assertEgressReady, EgressStatus, createAdminStepUpGuard, requireAdminStepUp,
  runDailyKeyRecheck, SYSTEM_ACTOR, SecurityError,
} from '../src/trading_agent/security/index.mjs';
import { scanText, scanLicences, deniedExpression } from '../../../scripts/trading/security-scan.mjs';

// Stage 28 (option 1, no cloud KMS). Synthetic keys only; no network.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const CTX = { credentialId: 'bkc_1', brokerAccountId: 'bka_1', principalId: 'prn_alice' };
const code = async (fn) => { try { await fn(); } catch (e) { return e.code; } return null; };
const local = () => new LocalDevKeyProvider({ masterKey: randomBytes(32) });

/** In-memory fake KMS: GenerateDataKey / Decrypt over fetch, enforcing EncryptionContext equality. */
function fakeKms() {
  const blobs = new Map(); const calls = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body); const target = init.headers['x-amz-target'];
    calls.push({ url, headers: init.headers, body });
    const ctx = JSON.stringify(body.EncryptionContext);
    if (target === 'TrentService.GenerateDataKey') {
      const pt = randomBytes(32); const blob = randomBytes(48).toString('base64');
      blobs.set(blob, { pt, ctx });
      return new Response(JSON.stringify({ KeyId: 'arn:aws:kms:ap-south-1:111122223333:key/abc', Plaintext: pt.toString('base64'), CiphertextBlob: blob }), { status: 200 });
    }
    const b = blobs.get(body.CiphertextBlob);
    if (!b || b.ctx !== ctx) return new Response(JSON.stringify({ __type: 'com.amazonaws.kms#InvalidCiphertextException' }), { status: 400 });
    return new Response(JSON.stringify({ Plaintext: b.pt.toString('base64') }), { status: 200 });
  };
  return { fetch, calls };
}
const awsProvider = (fetch) => new AwsKmsKeyProvider({ region: 'ap-south-1', keyId: 'alias/satelink-trading', credentials: async () => ({ accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'test-secret-not-real' }), fetch, clock: () => new Date('2026-10-07T00:00:00Z') });

describe('trading: Stage 28 security (option 1)', () => {
  describe('envelope encryption', () => {
    it('round-trips through the local provider; the row maps onto broker_credential_ciphertexts', async () => {
      const p = local();
      const row = await sealSecret({ provider: p, plaintext: 'binance-api-secret-value', context: CTX });
      expect(Object.keys(row)).to.include.members(['encryption_alg', 'wrapped_dek', 'iv', 'auth_tag', 'ciphertext', 'kms_key_ref']);
      expect(row.encryption_alg).to.equal('AES-256-GCM');
      expect(row.ciphertext.toString('utf8')).to.not.include('binance-api-secret');
      expect(row.kms_key_ref).to.match(/^local:local-dev-1:[0-9a-f]{12}$/);
      expect(await openSecret({ provider: p, row, context: { ...CTX } })).to.equal('binance-api-secret-value');
    });

    for (const [name, mutate] of [
      ['another credential id', (r, c) => [r, { ...c, credentialId: 'bkc_2' }]],
      ['another principal', (r, c) => [r, { ...c, principalId: 'prn_bob' }]],
      ['tampered ciphertext', (r, c) => [{ ...r, ciphertext: Buffer.from(r.ciphertext.map((b, i) => (i === 0 ? b ^ 1 : b))) }, c]],
      ['tampered wrapped DEK', (r, c) => [{ ...r, wrapped_dek: Buffer.from(r.wrapped_dek.map((b, i) => (i === 40 ? b ^ 1 : b))) }, c]],
      ['tampered auth tag', (r, c) => [{ ...r, auth_tag: Buffer.alloc(16) }, c]],
      ['another key ref', (r, c) => [{ ...r, kms_key_ref: 'local:other:000000000000' }, c]],
    ]) {
      it(`refuses to decrypt with ${name} → DECRYPT_FAILED`, async () => {
        const p = local();
        const row = await sealSecret({ provider: p, plaintext: 's3cret', context: CTX });
        const [r, c] = mutate(row, CTX);
        expect(await code(() => openSecret({ provider: p, row: r, context: c }))).to.equal('DECRYPT_FAILED');
      });
    }

    it('a different master key cannot unwrap', async () => {
      const row = await sealSecret({ provider: local(), plaintext: 's3cret', context: CTX });
      expect(await code(() => openSecret({ provider: local(), row, context: CTX }))).to.equal('DECRYPT_FAILED');
    });

    it('rejects bad config: short master key, empty context, empty plaintext', async () => {
      expect(await code(() => new LocalDevKeyProvider({ masterKey: randomBytes(16) }))).to.equal('CONFIG');
      expect(await code(() => sealSecret({ provider: local(), plaintext: 'x', context: {} }))).to.equal('INVALID');
      expect(await code(() => sealSecret({ provider: local(), plaintext: '', context: CTX }))).to.equal('INVALID');
    });
  });

  describe('AWS KMS provider (written, OFF)', () => {
    it('signs GenerateDataKey/Decrypt with SigV4, sends the EncryptionContext, and round-trips', async () => {
      const kms = fakeKms();
      const p = awsProvider(kms.fetch);
      const row = await sealSecret({ provider: p, plaintext: 'upstox-token', context: CTX });
      expect(await openSecret({ provider: p, row, context: CTX })).to.equal('upstox-token');
      const [gen] = kms.calls;
      expect(gen.url).to.equal('https://kms.ap-south-1.amazonaws.com/');
      expect(gen.headers['x-amz-target']).to.equal('TrentService.GenerateDataKey');
      expect(gen.headers.authorization).to.match(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20261007\/ap-south-1\/kms\/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-target, Signature=[0-9a-f]{64}$/);
      expect(JSON.stringify(gen.headers)).to.not.include('test-secret-not-real');
      expect(gen.body.EncryptionContext).to.deep.equal({ brokerAccountId: 'bka_1', credentialId: 'bkc_1', principalId: 'prn_alice' });
      expect(gen.body.KeySpec).to.equal('AES_256');
    });

    it('KMS refuses a wrapped key under another context → DECRYPT_FAILED', async () => {
      const p = awsProvider(fakeKms().fetch);
      const row = await sealSecret({ provider: p, plaintext: 'x', context: CTX });
      expect(await code(() => openSecret({ provider: p, row, context: { ...CTX, credentialId: 'bkc_9' } }))).to.equal('DECRYPT_FAILED');
    });

    it('SigV4 is deterministic and binds the body', () => {
      const base = { host: 'kms.ap-south-1.amazonaws.com', region: 'ap-south-1', target: 'TrentService.Decrypt', credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'k' }, now: new Date('2026-10-07T00:00:00Z') };
      expect(signV4({ ...base, body: '{}' })).to.deep.equal(signV4({ ...base, body: '{}' }));
      expect(signV4({ ...base, body: '{}' }).authorization).to.not.equal(signV4({ ...base, body: '{"a":1}' }).authorization);
    });

    it('network failure / 5xx → PROVIDER_UNAVAILABLE (retryable), never a silent success', async () => {
      const down = awsProvider(async () => { throw new Error('ECONNRESET'); });
      expect(await code(() => sealSecret({ provider: down, plaintext: 'x', context: CTX }))).to.equal('PROVIDER_UNAVAILABLE');
      const s500 = awsProvider(async () => new Response('{}', { status: 503 }));
      expect(await code(() => sealSecret({ provider: s500, plaintext: 'x', context: CTX }))).to.equal('PROVIDER_UNAVAILABLE');
    });
  });

  describe('provider selection (fail closed)', () => {
    const mk = () => randomBytes(32);
    it('nothing configured → NOT_CONFIGURED', async () => {
      expect(await code(() => keyProviderFromConfig({ env: {} }))).to.equal('NOT_CONFIGURED');
    });
    it('local is fine in dev, REFUSED in production unless the founder accepted a capped beta', async () => {
      expect(keyProviderFromConfig({ env: { TRADING_KMS_PROVIDER: 'local' }, loadLocalMasterKey: mk }).id).to.equal('local-dev');
      expect(await code(() => keyProviderFromConfig({ env: { TRADING_KMS_PROVIDER: 'local', NODE_ENV: 'production' }, loadLocalMasterKey: mk }))).to.equal('REFUSED');
      expect(keyProviderFromConfig({ env: { TRADING_KMS_PROVIDER: 'local', NODE_ENV: 'production', TRADING_LOCAL_KEY_PROVIDER_ACCEPTED: 'capped-beta' }, loadLocalMasterKey: mk }).id).to.equal('local-dev');
    });
    it('aws is OFF unless TRADING_AWS_KMS_ENABLED=true', async () => {
      const aws = { region: 'ap-south-1', keyId: 'alias/x', credentials: async () => ({}), fetch: fakeKms().fetch };
      expect(await code(() => keyProviderFromConfig({ env: { TRADING_KMS_PROVIDER: 'aws' }, aws }))).to.equal('REFUSED');
      expect(keyProviderFromConfig({ env: { TRADING_KMS_PROVIDER: 'aws', TRADING_AWS_KMS_ENABLED: 'true' }, aws }).id).to.equal('aws-kms');
    });
    it('provider modules never read process.env or the filesystem for key material', () => {
      for (const f of ['providers/local_dev.mjs', 'providers/aws_kms.mjs', 'envelope.mjs']) {
        const src = fs.readFileSync(path.join(ROOT, 'apps/api/src/trading_agent/security', f), 'utf8');
        expect(src, f).to.not.match(/process\.env|readFileSync|from 'node:fs'/);
      }
    });
  });

  describe('static egress declaration', () => {
    it('unset → NOT_PROVISIONED; assertEgressReady refuses', async () => {
      expect(egressConfig({}).status).to.equal(EgressStatus.NOT_PROVISIONED);
      expect(await code(() => assertEgressReady({}))).to.equal('EGRESS_NOT_READY');
    });
    for (const [env, why] of [
      [{ TRADING_EXECUTION_EGRESS_IP: '10.0.0.4', TRADING_EXECUTION_REGION: 'europe-west4' }, 'private IP'],
      [{ TRADING_EXECUTION_EGRESS_IP: '203.0.113.300', TRADING_EXECUTION_REGION: 'europe-west4' }, 'malformed IP'],
      [{ TRADING_EXECUTION_EGRESS_IP: '34.120.1.2', TRADING_EXECUTION_REGION: 'us-west2' }, 'US region (Binance geo-block)'],
      [{ TRADING_EXECUTION_EGRESS_IP: '34.120.1.2' }, 'no region'],
    ]) {
      it(`INVALID: ${why}`, () => expect(egressConfig(env).status).to.equal(EgressStatus.INVALID));
    }
    it('a public IP in a permitted region → DECLARED', () => {
      expect(assertEgressReady({ TRADING_EXECUTION_EGRESS_IP: '34.120.1.2', TRADING_EXECUTION_REGION: 'asia-southeast1' })).to.include({ status: 'DECLARED', ip: '34.120.1.2' });
    });
  });

  describe('admin step-up', () => {
    const setup = (staff = ['prn_admin']) => {
      const log = [];
      const guard = createAdminStepUpGuard({
        isStaff: async (p) => staff.includes(p),
        stepUp: { verify: async ({ code: c }) => (c === '123456' ? { ok: true, method: 'totp' } : { ok: false, reason: 'invalid_code' }) },
        audit: { append: async (e) => { log.push(e); } },
        clock: () => new Date('2026-10-07T00:00:00Z'),
      });
      return { guard, log };
    };
    it('non-staff → FORBIDDEN even with a valid code; every attempt is audited', async () => {
      const { guard, log } = setup();
      expect(await code(() => guard.authorize({ principalId: 'prn_alice', action: 'risk_policy.update', code: '123456' }))).to.equal('FORBIDDEN');
      expect(log).to.have.length(1);
      expect(log[0]).to.include({ outcome: 'denied', reason: 'not_staff' });
    });
    it('staff without a code → STEP_UP_REQUIRED; wrong code → STEP_UP_FAILED; valid → allowed', async () => {
      const { guard, log } = setup();
      expect(await code(() => guard.authorize({ principalId: 'prn_admin', action: 'risk_policy.update' }))).to.equal('STEP_UP_REQUIRED');
      expect(await code(() => guard.authorize({ principalId: 'prn_admin', action: 'risk_policy.update', code: '000000' }))).to.equal('STEP_UP_FAILED');
      expect(await guard.authorize({ principalId: 'prn_admin', action: 'risk_policy.update', code: '123456' })).to.deep.equal({ ok: true, method: 'totp' });
      expect(log.map((l) => l.outcome)).to.deep.equal(['denied', 'denied', 'allowed']);
    });
    it('a code is single-use per action; unknown actions are refused', async () => {
      const { guard } = setup();
      await guard.authorize({ principalId: 'prn_admin', action: 'kill_switch.global.release', code: '123456' });
      expect(await code(() => guard.authorize({ principalId: 'prn_admin', action: 'kill_switch.global.release', code: '123456' }))).to.equal('STEP_UP_FAILED');
      expect(await code(() => guard.authorize({ principalId: 'prn_admin', action: 'withdraw', code: '123456' }))).to.equal('INVALID');
    });
    it('middleware: 403 non-staff, 401 no code, next() on success', async () => {
      const { guard } = setup();
      const mw = requireAdminStepUp(guard, 'mandate.admin_revoke');
      const run = (principal, hdr) => new Promise((resolve) => {
        const res = { status(s) { this.s = s; return this; }, json(b) { resolve({ status: this.s, body: b }); } };
        mw({ principal, headers: hdr ?? {} }, res, () => resolve({ status: 'next' }));
      });
      expect((await run({ id: 'prn_alice' }, { 'x-step-up-code': '123456' })).status).to.equal(403);
      expect((await run({ id: 'prn_admin' })).status).to.equal(401);
      expect((await run({ id: 'prn_admin' }, { 'x-step-up-code': '123456' })).status).to.equal('next');
    });
  });

  describe('daily Binance key re-check', () => {
    const okR = { enableWithdrawals: false, enableInternalTransfer: false, permitsUniversalTransfer: false, ipRestrict: true, enableSpotAndMarginTrading: true, enableReading: true };
    it('a widened key or a failed check engages the broker_account kill switch as SYSTEM and alerts', async () => {
      const engaged = []; const alerts = [];
      const r = await runDailyKeyRecheck({
        accounts: async () => [{ brokerAccountId: 'bka_ok', principalId: 'prn_a' }, { brokerAccountId: 'bka_wide', principalId: 'prn_b' }, { brokerAccountId: 'bka_err', principalId: 'prn_c' }],
        fetchRestrictions: async (id) => { if (id === 'bka_err') throw Object.assign(new Error('x'), { code: 'TIMEOUT' }); return id === 'bka_wide' ? { ...okR, enableWithdrawals: true, ipRestrict: false } : okR; },
        killSwitch: { engage: async (req) => { engaged.push(req); } },
        alert: async (a) => { alerts.push(a); },
        clock: () => new Date('2026-10-07T00:00:00Z'),
      });
      expect(r).to.include({ checked: 3, failed: 2 });
      expect(engaged.map((e) => [e.scopeType, e.scopeId, e.principalId, e.actor])).to.deep.equal([
        ['broker_account', 'bka_wide', 'prn_b', SYSTEM_ACTOR], ['broker_account', 'bka_err', 'prn_c', SYSTEM_ACTOR],
      ]);
      expect(engaged[0].reason).to.match(/enableWithdrawals must be false/);
      expect(alerts.map((a) => a.brokerAccountId)).to.deep.equal(['bka_wide', 'bka_err']);
    });
  });

  describe('CI scans (report-only)', () => {
    it('detects secret patterns by name without echoing the value', () => {
      const fake = ['AK', 'IA', 'ABCDEFGHIJKLMNOP'].join('');
      const f = scanText('x.js', `const k = "${fake}";\nok`);
      expect(f).to.deep.equal([{ file: 'x.js', line: 1, pattern: 'aws_access_key_id' }]);
      expect(JSON.stringify(f)).to.not.include(fake);
    });
    it('licences: AGPL/unknown flagged in production deps, dual MIT-or-GPL and dev deps are not', () => {
      expect(deniedExpression('(MIT OR GPL-3.0-or-later)')).to.equal(false);
      expect(deniedExpression('AGPL-3.0-or-later')).to.equal(true);
      const out = scanLicences({ packages: {
        '': {}, 'node_modules/a': { version: '1', license: 'AGPL-3.0' }, 'node_modules/b': { version: '1', license: 'MIT' },
        'node_modules/c': { version: '1' }, 'node_modules/d': { version: '1', license: 'GPL-2.0', dev: true },
      } });
      expect(out.map((x) => [x.package, x.licence])).to.deep.equal([['a', 'AGPL-3.0'], ['c', 'UNKNOWN']]);
    });
    it('the workflow is non-breaking (continue-on-error, no --strict)', () => {
      const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/trading-security-scans.yml'), 'utf8');
      expect(wf).to.match(/continue-on-error: true/);
      expect(wf).to.not.match(/--strict/);
    });
  });

  it('is not mounted by the API', () => {
    for (const f of ['apps/api/app_factory.mjs', 'apps/api/server.js']) expect(fs.readFileSync(path.join(ROOT, f), 'utf8')).to.not.match(/trading_agent\/security/);
  });

  it('SecurityError carries a stable code', () => expect(new SecurityError('X', 'y').code).to.equal('X'));
});
