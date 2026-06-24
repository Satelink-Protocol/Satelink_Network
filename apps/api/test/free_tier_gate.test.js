// Regression: a funded API-key caller must NOT be IP-rate-limited as anonymous
// free traffic. The free-tier gate bypasses authenticated callers (bound wallet
// OR X-API-Key) so creditService (authorizeAndMeter) can deduct + meter.
// Root cause: free_tier_gate.js previously bypassed only x-wallet-address, so
// X-API-Key callers were 402'd at FREE_TIER_LIMIT_REACHED before deduction.

import { expect } from 'chai';

describe('freeTierGate — authenticated bypass (revenue unblock)', () => {
  let createFreeTierGate;

  before(async () => {
    // Low limit so the gate trips after 2 anonymous calls. Set BEFORE import:
    // the module reads FREE_TIER_DAILY_LIMIT at load time.
    process.env.FREE_TIER_DAILY_LIMIT = '2';
    ({ createFreeTierGate } = await import('../src/middleware/free_tier_gate.js'));
  });

  // Invoke the gate once; resolves with whichever happened: next() or a JSON response.
  function invoke(gate, { headers = {}, ip = '1.2.3.4' } = {}) {
    return new Promise((resolve) => {
      const req = { headers, body: { id: 1 }, socket: { remoteAddress: ip } };
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

  // Drive an IP over the free-tier limit with anonymous calls.
  async function exhaust(gate, ip) {
    await invoke(gate, { ip });
    await invoke(gate, { ip });
    return invoke(gate, { ip }); // 3rd call: count 3 > limit 2 → 402
  }

  it('anonymous under limit → passes through (next)', async () => {
    const gate = createFreeTierGate(console);
    const r = await invoke(gate, { ip: '10.0.0.1' });
    expect(r.nextCalled).to.equal(true);
  });

  it('anonymous over limit → 402 FREE_TIER_LIMIT_REACHED', async () => {
    const gate = createFreeTierGate(console);
    const r = await exhaust(gate, '10.0.0.2');
    expect(r.statusCode).to.equal(402);
    expect(r.payload?.error?.data?.error_code).to.equal('FREE_TIER_LIMIT_REACHED');
    expect(r.nextCalled).to.equal(false);
  });

  it('wallet-authenticated → bypasses the gate even when the IP is over limit', async () => {
    const gate = createFreeTierGate(console);
    await exhaust(gate, '10.0.0.3'); // IP now over limit
    const r = await invoke(gate, {
      ip: '10.0.0.3',
      headers: { 'x-wallet-address': '0x1111111111111111111111111111111111111111' },
    });
    expect(r.nextCalled).to.equal(true);
    expect(r.statusCode).to.equal(null);
  });

  it('API-key-authenticated → bypasses the gate even when the IP is over limit (THE FIX)', async () => {
    const gate = createFreeTierGate(console);
    await exhaust(gate, '10.0.0.4'); // IP now over limit
    const r = await invoke(gate, {
      ip: '10.0.0.4',
      // Placeholder key — the gate does NOT validate keys; any sk_ value bypasses.
      headers: { 'x-api-key': 'sk_live_placeholder_not_a_real_key' },
    });
    expect(r.nextCalled).to.equal(true); // reaches creditService instead of 402
    expect(r.statusCode).to.equal(null);
  });

  it('any X-API-Key bypasses the gate — validity (401 unknown / deduct funded) is creditService\'s job', async () => {
    // The gate does NOT validate keys; it forwards ALL keyed requests to
    // authorizeAndMeter, which 401s unknown keys and deducts funded ones
    // (covered by test/credit_service.test.js).
    const gate = createFreeTierGate(console);
    await exhaust(gate, '10.0.0.5');
    const unknown = await invoke(gate, { ip: '10.0.0.5', headers: { 'x-api-key': 'sk_unknown_xyz' } });
    expect(unknown.nextCalled).to.equal(true);
  });
});
