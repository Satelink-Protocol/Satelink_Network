// ws_gateway_payer_identity.test.js
//
// WS twin of finding C1 (credit theft via spoofed x-wallet-address).
// The HTTP path was fixed in PR #357 (rpc_gateway.js, free_tier_gate.js,
// credit_gate.js, x402/middleware.js). The WS gateway (ws_gateway.js:52)
// still treats a bare x-wallet-address header as authenticated — same
// vulnerability class, different transport.
//
// Mirrors c1_payer_address.test.js but tests wsHasAuth in isolation (no
// DB required) because ws_gateway has no deduction path — the issue is
// that a spoofed header bypasses the 401 upgrade rejection, granting
// a free authenticated WS connection (and unbilled revenue event writes).
//
// NEGATIVE: x-wallet-address alone → wsHasAuth must return false (401)
// POSITIVE: x-api-key → wsHasAuth must return true
// POSITIVE: api_key query param → wsHasAuth must return true
// NEGATIVE: x-payer-address alone → wsHasAuth must return false

import { expect } from 'chai';
import { wsHasAuth } from '../src/workloads/rpc_gateway/ws_gateway.js';

describe('WS gateway payer identity — wsHasAuth', function () {

  it('NEGATIVE: bare x-wallet-address alone must NOT authenticate', () => {
    const req = {
      headers: { 'x-wallet-address': '0xAaAa000000000000000000000000000000000A11' },
      url: '/rpc/ws/polygon',
    };
    expect(wsHasAuth(req), 'bare x-wallet-address must not bypass the 401 gate').to.equal(false);
  });

  it('NEGATIVE: bare x-payer-address alone must NOT authenticate', () => {
    const req = {
      headers: { 'x-payer-address': '0xAaAa000000000000000000000000000000000A11' },
      url: '/rpc/ws/polygon',
    };
    expect(wsHasAuth(req), 'x-payer-address must not bypass the 401 gate').to.equal(false);
  });

  it('POSITIVE: x-api-key authenticates', () => {
    const req = {
      headers: { 'x-api-key': 'test_api_key_12345678' },
      url: '/rpc/ws/polygon',
    };
    expect(wsHasAuth(req)).to.equal(true);
  });

  it('POSITIVE: api_key query param authenticates', () => {
    const req = {
      headers: {},
      url: '/rpc/ws/polygon?api_key=test_api_key_12345678',
    };
    expect(wsHasAuth(req)).to.equal(true);
  });

  it('POSITIVE: token query param authenticates', () => {
    const req = {
      headers: {},
      url: '/rpc/ws/polygon?token=some_token',
    };
    expect(wsHasAuth(req)).to.equal(true);
  });

  it('NEGATIVE: empty headers and no query → false', () => {
    const req = {
      headers: {},
      url: '/rpc/ws/polygon',
    };
    expect(wsHasAuth(req)).to.equal(false);
  });

  it('NEGATIVE: x-wallet-address WITH x-api-key → true (api-key is the auth, not the wallet)', () => {
    const req = {
      headers: {
        'x-api-key': 'test_real_key',
        'x-wallet-address': '0xAaAa000000000000000000000000000000000A11',
      },
      url: '/rpc/ws/polygon',
    };
    expect(wsHasAuth(req), 'api-key present → authenticated regardless of wallet header').to.equal(true);
  });

  it('NEGATIVE: x-wallet-address in query (not header) must NOT authenticate', () => {
    const req = {
      headers: {},
      url: '/rpc/ws/polygon?wallet=0xAaAa000000000000000000000000000000000A11',
    };
    expect(wsHasAuth(req)).to.equal(false);
  });
});

// ── Step 2 (2026-09-15): presence is not identity ─────────────────────────
// wsHasAuth only checks that a credential is PRESENT. The upgrade must also
// DERIVE an identity: the key has to resolve to an active api_credits account
// (resolveAccount, by api_key only). A fabricated key or a wallet header must
// never open a connection.

import http from 'node:http';
import { WebSocket } from 'ws';
import { wsResolveAccount, createWsGateway } from '../src/workloads/rpc_gateway/ws_gateway.js';

const VALID_KEY = 'sk_ws_valid_0001';
const INACTIVE_KEY = 'sk_ws_inactive_0002';
const VICTIM_WALLET = '0xaaaa000000000000000000000000000000000a11';

function fakePool({ throws = false } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (throws) throw new Error('db down');
      if (/WHERE api_key = \$1/.test(sql)) {
        if (params[0] === VALID_KEY) return { rows: [{ api_key: VALID_KEY, wallet_address: VICTIM_WALLET, status: 'active' }] };
        if (params[0] === INACTIVE_KEY) return { rows: [{ api_key: INACTIVE_KEY, wallet_address: null, status: 'suspended' }] };
        return { rows: [] };
      }
      if (/lower\(wallet_address\)/.test(sql)) {
        return { rows: [{ api_key: VALID_KEY, wallet_address: VICTIM_WALLET, status: 'active' }] };
      }
      return { rows: [] };
    },
  };
}

describe('WS gateway payer identity — wsResolveAccount (identity derived, not asserted)', function () {
  it('NEGATIVE: fabricated x-api-key (present but unknown) → null', async () => {
    const pool = fakePool();
    const acct = await wsResolveAccount({ headers: { 'x-api-key': 'sk_made_up' }, url: '/rpc/ws/polygon' }, pool);
    expect(acct).to.equal(null);
  });

  it('NEGATIVE: bare x-wallet-address naming a funded wallet → null, and no wallet lookup is ever made', async () => {
    const pool = fakePool();
    const acct = await wsResolveAccount({ headers: { 'x-wallet-address': VICTIM_WALLET }, url: '/rpc/ws/polygon' }, pool);
    expect(acct).to.equal(null);
    expect(pool.calls.some((c) => /wallet_address\)/.test(c.sql))).to.equal(false);
  });

  it('NEGATIVE: fabricated key + victim wallet header → null (wallet never used as a fallback)', async () => {
    const pool = fakePool();
    const acct = await wsResolveAccount(
      { headers: { 'x-api-key': 'sk_made_up', 'x-wallet-address': VICTIM_WALLET }, url: '/rpc/ws/polygon' }, pool);
    expect(acct).to.equal(null);
    expect(pool.calls.some((c) => /wallet_address\)/.test(c.sql))).to.equal(false);
  });

  it('NEGATIVE: inactive account → null', async () => {
    const acct = await wsResolveAccount({ headers: { 'x-api-key': INACTIVE_KEY }, url: '/rpc/ws/polygon' }, fakePool());
    expect(acct).to.equal(null);
  });

  it('NEGATIVE: no pool → null (fails closed)', async () => {
    expect(await wsResolveAccount({ headers: { 'x-api-key': VALID_KEY }, url: '/rpc/ws/polygon' }, null)).to.equal(null);
  });

  it('NEGATIVE: DB error → null (fails closed)', async () => {
    const acct = await wsResolveAccount({ headers: { 'x-api-key': VALID_KEY }, url: '/rpc/ws/polygon' }, fakePool({ throws: true }));
    expect(acct).to.equal(null);
  });

  it('POSITIVE: valid active key (header) → account', async () => {
    const acct = await wsResolveAccount({ headers: { 'x-api-key': VALID_KEY }, url: '/rpc/ws/polygon' }, fakePool());
    expect(acct.api_key).to.equal(VALID_KEY);
  });

  it('POSITIVE: valid active key (?api_key query) → account', async () => {
    const acct = await wsResolveAccount({ headers: {}, url: `/rpc/ws/polygon?api_key=${VALID_KEY}` }, fakePool());
    expect(acct.api_key).to.equal(VALID_KEY);
  });
});

describe('WS gateway payer identity — real HTTP upgrade', function () {
  let server;
  let port;

  before(async () => {
    server = http.createServer((_req, res) => { res.statusCode = 404; res.end(); });
    createWsGateway(server, fakePool());
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  function tryUpgrade(headers, query = '') {
    return new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/rpc/ws/unsupported-chain${query}`, { headers });
      ws.on('unexpected-response', (_req, res) => resolve({ status: res.statusCode }));
      ws.on('open', () => { resolve({ status: 101 }); ws.terminate(); });
      ws.on('error', () => {});
    });
  }

  it('NEGATIVE: bare x-wallet-address → 401, connection never opens', async () => {
    expect((await tryUpgrade({ 'x-wallet-address': VICTIM_WALLET })).status).to.equal(401);
  });

  it('NEGATIVE: fabricated x-api-key → 401, connection never opens', async () => {
    expect((await tryUpgrade({ 'x-api-key': 'sk_made_up' })).status).to.equal(401);
  });

  it('POSITIVE: valid active x-api-key → 101 upgrade', async () => {
    expect((await tryUpgrade({ 'x-api-key': VALID_KEY })).status).to.equal(101);
  });
});
