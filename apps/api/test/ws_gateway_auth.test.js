// WS RPC auth gate (2026-08-27): the WebSocket gateway must require the same
// credential as HTTP /rpc so an anonymous client can never open a subscription
// firehose that writes a revenue_events_v2 row per streamed event (the Aug-2026
// ws_subscription storm: 345,820 rows @ $0.000001, 100k+/hour).

import { expect } from 'chai';
import { wsHasAuth } from '../src/workloads/rpc_gateway/ws_gateway.js';

const upgrade = ({ headers = {}, url = '/rpc/ws/polygon' } = {}) => ({ headers, url });

describe('wsHasAuth — WS RPC requires a credential (free tier removed)', () => {
  it('no header, no query → unauthenticated (upgrade rejected)', () => {
    expect(wsHasAuth(upgrade())).to.equal(false);
  });

  it('x-api-key header → authenticated', () => {
    expect(wsHasAuth(upgrade({ headers: { 'x-api-key': 'k' } }))).to.equal(true);
  });

  it('x-wallet-address header alone → NOT authenticated (P0-wallet-auth, same as HTTP C1 fix)', () => {
    // Pre-fix this returned true — the same C1 vulnerability class as the HTTP
    // path (#357). A bare x-wallet-address names no verified identity.
    expect(wsHasAuth(upgrade({ headers: { 'x-wallet-address': '0x' + '1'.repeat(40) } }))).to.equal(false);
  });

  it('?api_key query → authenticated (browser WS clients cannot set headers)', () => {
    expect(wsHasAuth(upgrade({ url: '/rpc/ws/polygon?api_key=k' }))).to.equal(true);
  });

  it('?token query → authenticated', () => {
    expect(wsHasAuth(upgrade({ url: '/rpc/ws/base?token=t' }))).to.equal(true);
  });

  it('empty-valued credential does NOT authenticate', () => {
    expect(wsHasAuth(upgrade({ headers: { 'x-api-key': '' } }))).to.equal(false);
    expect(wsHasAuth(upgrade({ url: '/rpc/ws/polygon?api_key=' }))).to.equal(false);
  });

  it('malformed url → unauthenticated (fails closed)', () => {
    expect(wsHasAuth({ headers: {}, url: null })).to.equal(false);
  });
});
