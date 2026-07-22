// CDP inbound verifier — adversarial tests with a stub facilitator (the real
// verify/settle wire boundary is the only thing stubbed; all guard logic is real).
// Run: `node --test test/vnext_inbound_verifier_m7.test.js`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createCdpInboundVerifier } from '../src/vnext/adapters/x402/cdp_inbound_verifier.js';

const goodHeader = Buffer.from(JSON.stringify({ x402Version: 1, scheme: 'exact', payload: { from: '0xCaller' } })).toString('base64');
const args = (over = {}) => ({ header: goodHeader, price: '1025', unit: 'USDC', resource: 'https://m/x', payTo: '0xSatelink', network: 'eip155:8453', ...over });

function facilitator({ verify, settle }) { return { verify: verify || (async () => ({ isValid: true })), settle: settle || (async () => ({ success: true, transaction: '0xTX', payer: '0xCaller', amount: '1025' })) }; }

test('happy path: verified + settled -> settled with tx ref, payer, amount', async () => {
  const v = createCdpInboundVerifier({ facilitator: facilitator({}) });
  const r = await v(args());
  assert.equal(r.settled, true);
  assert.equal(r.amount, '1025');
  assert.equal(r.txRef, '0xTX');
  assert.equal(r.payer, '0xCaller');
});

test('forged/malformed header -> rejected, facilitator never called', async () => {
  let called = false;
  const v = createCdpInboundVerifier({ facilitator: facilitator({ verify: async () => { called = true; return { isValid: true }; } }) });
  const r = await v(args({ header: 'not-base64-json' }));
  assert.equal(r.settled, false);
  assert.equal(r.reason, 'malformed_payment');
  assert.equal(called, false);
});

test('verify fails -> rejected, settle never called (no money moves)', async () => {
  let settled = false;
  const v = createCdpInboundVerifier({ facilitator: facilitator({ verify: async () => ({ isValid: false, invalidReason: 'bad_sig' }), settle: async () => { settled = true; return { success: true }; } }) });
  const r = await v(args());
  assert.equal(r.settled, false);
  assert.equal(r.reason, 'bad_sig');
  assert.equal(settled, false);
});

test('settle fails -> rejected (no false positive)', async () => {
  const v = createCdpInboundVerifier({ facilitator: facilitator({ settle: async () => ({ success: false, errorReason: 'insufficient_funds' }) }) });
  const r = await v(args());
  assert.equal(r.settled, false);
  assert.equal(r.reason, 'insufficient_funds');
});

test('underpay: facilitator-reported amount below price -> rejected', async () => {
  const v = createCdpInboundVerifier({ facilitator: facilitator({ settle: async () => ({ success: true, transaction: '0xTX', amount: '1000' }) }) });
  const r = await v(args({ price: '1025' }));
  assert.equal(r.settled, false);
  assert.equal(r.reason, 'underpaid');
});

test('fail-closed: verify throws -> rejected (never serve on error)', async () => {
  const v = createCdpInboundVerifier({ facilitator: facilitator({ verify: async () => { throw new Error('facilitator 502'); } }) });
  const r = await v(args());
  assert.equal(r.settled, false);
  assert.match(r.reason, /verify_error/);
});

test('fail-closed: settle throws -> rejected', async () => {
  const v = createCdpInboundVerifier({ facilitator: facilitator({ settle: async () => { throw new Error('rpc down'); } }) });
  const r = await v(args());
  assert.equal(r.settled, false);
  assert.match(r.reason, /settle_error/);
});

test('requirements pin payTo/price/network sent to the facilitator (no redirect/underquote)', async () => {
  let seen = null;
  const v = createCdpInboundVerifier({ facilitator: facilitator({ verify: async (_p, req) => { seen = req; return { isValid: true }; } }) });
  await v(args({ payTo: '0xSatelink', price: '1025', network: 'eip155:8453' }));
  assert.equal(seen.payTo, '0xSatelink');
  assert.equal(seen.maxAmountRequired, '1025');
  assert.equal(seen.network, 'eip155:8453');
  assert.equal(seen.scheme, 'exact');
});

test('constructor rejects a facilitator missing verify/settle', () => {
  assert.throws(() => createCdpInboundVerifier({ facilitator: {} }), /verify\(\)\/settle\(\)/);
});
