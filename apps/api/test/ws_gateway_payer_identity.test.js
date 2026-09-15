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
