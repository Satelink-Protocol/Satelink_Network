// Anonymous free-tier cut (2026-08-10): anonymous callers (no authentication
// signal) get FREE_TIER_ANON_CALLS free calls (default 0) before the x402 402
// payment challenge is returned — on the FIRST request by default. Any request
// carrying one of the recognized auth signals is NOT treated as anonymous and
// keeps the standard free tier. FREE_TIER_ANON_CALLS is read at request time so
// a Railway env-var change rolls the quota back on restart, no code redeploy.
//
// The gate is exercised in isolation (no redis → in-memory counters), the same
// way free_tier_gate.test.js drives it. Distinct IPs per case keep the shared
// module-level counter map from leaking between assertions.

import { expect } from 'chai';

describe('freeTierGate — anonymous free-tier cut (FREE_TIER_ANON_CALLS)', () => {
  let createFreeTierGate;
  const silent = { info() {}, warn() {}, error() {} };

  before(async () => {
    ({ createFreeTierGate } = await import('../src/middleware/free_tier_gate.js'));
  });

  // Invoke the gate once; resolves with whichever happened: next() or a JSON
  // response. Supports headers AND query params (req.query) so both classes of
  // auth signal can be exercised.
  function invoke(gate, { headers = {}, query = {}, ip } = {}) {
    return new Promise((resolve) => {
      const req = { headers, query, body: { id: 1 }, socket: { remoteAddress: ip } };
      const res = {
        statusCode: null,
        status(c) { this.statusCode = c; return this; },
        json(b) { resolve({ nextCalled: false, statusCode: this.statusCode, payload: b }); return this; },
        set() { return this; },
      };
      const next = () => resolve({ nextCalled: true, statusCode: null, payload: null });
      Promise.resolve(gate(req, res, next)).catch((err) => resolve({ error: err }));
    });
  }

  it('anonymous (no auth signal) → 402 on the FIRST call when FREE_TIER_ANON_CALLS=0', async () => {
    process.env.FREE_TIER_ANON_CALLS = '0';
    const gate = createFreeTierGate(silent);
    const r = await invoke(gate, { ip: '203.0.113.1' });

    expect(r.nextCalled, 'must NOT pass through').to.equal(false);
    expect(r.statusCode).to.equal(402);
    // The challenge body / acquisition path is unchanged from the exhausted-tier
    // 402 — same error contract, same self-onboarding register + vault fields.
    expect(r.payload?.error?.data?.error_code).to.equal('FREE_TIER_LIMIT_REACHED');
    const payment = r.payload?.error?.data?.payment;
    expect(payment?.register_url).to.match(/\/v1\/machine\/register$/);
    expect(payment?.vault_address).to.match(/^0x[0-9a-fA-F]{40}$/);
    expect(payment?.token).to.equal('USDT');
  });

  // Free-tier removal (2026-08-27): ONLY x-api-key and x-wallet-address bypass the
  // gate (short-circuit at the top → creditService). Every OTHER auth signal used
  // to keep the standard free tier; now it gets a 402 on the first call, because
  // the free tier is gone (FREE_TIER_DAILY_LIMIT defaults 0). See
  // free_tier_removed.test.js and docs/incidents/2026-08-27-freetier-backfill/.
  const BYPASS_CASES = [
    { name: 'x-api-key header',        req: { headers: { 'x-api-key': 'sk_free_placeholder' } } },
  ];
  // P0 payer-identity (2026-09): x-wallet-address is NO LONGER a bypass — a bare
  // wallet header names no verified identity, so it is throttled like anonymous
  // traffic (402), same as x-payer-address.
  const REMOVED_TIER_CASES = [
    { name: 'authorization header',     req: { headers: { authorization: 'Bearer token.value' } } },
    { name: 'x-admin-key header',       req: { headers: { 'x-admin-key': 'admin-secret' } } },
    { name: 'x-admin-token header',     req: { headers: { 'x-admin-token': 'admin-token' } } },
    { name: 'x-enterprise-key header',  req: { headers: { 'x-enterprise-key': 'ent-key' } } },
    { name: 'x-wallet-address header',  req: { headers: { 'x-wallet-address': '0x' + '2'.repeat(40) } } },
    { name: 'x-payer-address header',   req: { headers: { 'x-payer-address': '0x' + '1'.repeat(40) } } },
    { name: 'payment-signature header', req: { headers: { 'payment-signature': 'base64payload' } } },
    { name: 'x-payment header',         req: { headers: { 'x-payment': 'base64payload' } } },
    { name: 'api_key query param',      req: { query: { api_key: 'sk_free_placeholder' } } },
    { name: 'token query param',        req: { query: { token: 'admin-token' } } },
  ];

  BYPASS_CASES.forEach((c, i) => {
    it(`bypass credential "${c.name}" → served on first call (reaches creditService)`, async () => {
      process.env.FREE_TIER_ANON_CALLS = '0';
      process.env.FREE_TIER_DAILY_LIMIT = '0';
      const gate = createFreeTierGate(silent);
      const r = await invoke(gate, { ...c.req, ip: `203.0.114.${i + 1}` });

      expect(r.error, 'no error thrown').to.equal(undefined);
      expect(r.nextCalled, `${c.name} must pass through to creditService`).to.equal(true);
      expect(r.statusCode).to.equal(null);
    });
  });

  REMOVED_TIER_CASES.forEach((c, i) => {
    it(`non-bypass auth signal "${c.name}" → 402 on first call (free tier removed)`, async () => {
      process.env.FREE_TIER_ANON_CALLS = '0';
      process.env.FREE_TIER_DAILY_LIMIT = '0';
      const gate = createFreeTierGate(silent);
      const r = await invoke(gate, { ...c.req, ip: `203.0.120.${i + 1}` });

      expect(r.error, 'no error thrown').to.equal(undefined);
      expect(r.nextCalled, `${c.name} must NOT be served — no free tier`).to.equal(false);
      expect(r.statusCode).to.equal(402);
    });
  });

  it('an empty-valued auth header does NOT count as authenticated (still anonymous → 402)', async () => {
    // Mirrors the edge rule's zero-length check: a header present but empty is
    // treated as absent, so such a caller is still anonymous.
    process.env.FREE_TIER_ANON_CALLS = '0';
    const gate = createFreeTierGate(silent);
    const r = await invoke(gate, { headers: { 'x-api-key': '', authorization: '' }, ip: '203.0.117.1' });
    expect(r.statusCode).to.equal(402);
  });

  it('FREE_TIER_ANON_CALLS=5 → old quota behavior restored (5 served, 6th → 402)', async () => {
    process.env.FREE_TIER_ANON_CALLS = '5';
    const gate = createFreeTierGate(silent);
    const ip = '203.0.115.1';
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await invoke(gate, { ip }));

    for (let i = 0; i < 5; i++) {
      expect(results[i].nextCalled, `call ${i + 1} should be served`).to.equal(true);
    }
    expect(results[5].nextCalled, '6th call should be walled').to.equal(false);
    expect(results[5].statusCode).to.equal(402);
    expect(results[5].payload?.error?.data?.error_code).to.equal('FREE_TIER_LIMIT_REACHED');
  });

  it('invalid FREE_TIER_ANON_CALLS fails CLOSED to 0 — never unlimited', async () => {
    // A non-numeric value must not disable the gate (a raw `count > NaN` is
    // always false → would silently serve everyone). It must fall back to 0.
    process.env.FREE_TIER_ANON_CALLS = 'not-a-number';
    const gate = createFreeTierGate(silent);
    const r = await invoke(gate, { ip: '203.0.116.1' });
    expect(r.statusCode).to.equal(402);
  });
});
