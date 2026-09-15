// Free-tier removal (2026-08-27 founder decision): /rpc/* requires x-api-key
// (or a settled x402 payment, handled upstream). x-wallet-address ALONE no
// longer bypasses this gate or drives billing (P0-wallet-auth, 2026-09) — it
// named no verified identity. Every other caller — anonymous OR presenting a
// non-key auth signal (authorization / x-payer-address / x-wallet-address /
// ?api_key) — gets a 402 on the FIRST call and NEVER reaches the RPC gateway,
// so nothing is written to the money path.
//
// This is the behavioral inverse of the old free tier, where a caller with any
// auth signal received FREE_TIER_DAILY_LIMIT (default 500) free calls first.
// FREE_TIER_DAILY_LIMIT / FREE_TIER_ANON_CALLS default 0 and are read at request
// time as emergency rollback levers.

import { expect } from 'chai';

describe('freeTierGate — free tier removed (auth required, nothing billed)', () => {
  let createFreeTierGate;
  let prevDaily, prevAnon;

  before(async () => {
    ({ createFreeTierGate } = await import('../src/middleware/free_tier_gate.js'));
    // Snapshot so this suite never leaks its production-default (0) env into a
    // sibling test file that runs after it and expects a non-zero rollback limit.
    prevDaily = process.env.FREE_TIER_DAILY_LIMIT;
    prevAnon = process.env.FREE_TIER_ANON_CALLS;
  });

  after(() => {
    if (prevDaily === undefined) delete process.env.FREE_TIER_DAILY_LIMIT;
    else process.env.FREE_TIER_DAILY_LIMIT = prevDaily;
    if (prevAnon === undefined) delete process.env.FREE_TIER_ANON_CALLS;
    else process.env.FREE_TIER_ANON_CALLS = prevAnon;
  });

  // Both limits read at REQUEST time — force the production defaults (0) here so
  // this suite is independent of whatever a sibling test file set at import.
  beforeEach(() => {
    process.env.FREE_TIER_DAILY_LIMIT = '0';
    process.env.FREE_TIER_ANON_CALLS = '0';
  });

  // Invoke the gate once; resolves with whichever happened: next() or a response.
  function invoke(gate, { headers = {}, query = {}, ip = '1.2.3.4' } = {}) {
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

  it('anonymous → 402 on the FIRST call, never reaches billing', async () => {
    const gate = createFreeTierGate(console);
    const r = await invoke(gate, { ip: '172.16.0.1' });
    expect(r.error, r.error?.message).to.equal(undefined);
    expect(r.statusCode).to.equal(402);
    expect(r.nextCalled).to.equal(false);
  });

  it('non-wallet/non-key auth signal (authorization header) → 402 on the FIRST call (THE CHANGE)', async () => {
    // Before the free-tier removal this caller received FREE_TIER_DAILY_LIMIT
    // free RPC bodies; now it is 402'd immediately.
    const gate = createFreeTierGate(console);
    const r = await invoke(gate, { ip: '172.16.0.2', headers: { authorization: 'Bearer whatever' } });
    expect(r.statusCode).to.equal(402);
    expect(r.nextCalled).to.equal(false);
  });

  it('?api_key query (not a header) → 402 on the FIRST call', async () => {
    const gate = createFreeTierGate(console);
    const r = await invoke(gate, { ip: '172.16.0.3', query: { api_key: 'q' } });
    expect(r.statusCode).to.equal(402);
    expect(r.nextCalled).to.equal(false);
  });

  it('x-api-key header → passes through to creditService (next)', async () => {
    const gate = createFreeTierGate(console);
    const r = await invoke(gate, { ip: '172.16.0.4', headers: { 'x-api-key': 'anything' } });
    expect(r.nextCalled).to.equal(true);
    expect(r.statusCode).to.equal(null);
  });

  it('x-wallet-address header alone → 401 on the FIRST call (P0-wallet-auth, 2026-09; Gate M0(a))', async () => {
    // It used to bypass here too — the same unverified-identity issue as
    // billing (finding C1's twin): a fabricated header got a free ride past
    // IP throttling. It is now rejected outright as an insufficient
    // credential — the same 401 rpc_gateway.js returns — regardless of budget.
    const gate = createFreeTierGate(console);
    const r = await invoke(gate, {
      ip: '172.16.0.5',
      headers: { 'x-wallet-address': '0x1111111111111111111111111111111111111111' },
    });
    expect(r.nextCalled).to.equal(false);
    expect(r.statusCode).to.equal(401);
    expect(r.payload.error).to.equal('wallet_header_insufficient');
  });

  it('the 402 body still carries the full self-onboarding path (register + deposit)', async () => {
    const gate = createFreeTierGate(console);
    const r = await invoke(gate, { ip: '172.16.0.6' });
    expect(r.statusCode).to.equal(402);
    expect(r.payload.register_url).to.match(/\/v1\/machine\/register$/);
    expect(r.payload?.error?.data?.payment?.vault_address).to.match(/^0x[0-9a-fA-F]{40}$/);
    // free tier is gone → the advertised limit is 0
    expect(r.payload?.error?.data?.limit).to.equal(0);
  });
});
