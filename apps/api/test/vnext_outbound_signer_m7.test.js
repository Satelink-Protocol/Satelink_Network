// EIP-3009 outbound signer — real ethers signing (no network). Proves the
// signature is cryptographically valid (recovers to the wallet), replay-safe
// (deterministic nonce), and correct in amount/recipient.
// Run: `node --test test/vnext_outbound_signer_m7.test.js`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { authorizationTypes } from '@x402/evm';
import { createEip3009OutboundSigner, nonceFromIdemKey } from '../src/vnext/adapters/x402/eip3009_outbound_signer.js';

// Deterministic throwaway wallet (fixed key -> reproducible; NOT a real wallet).
const TEST_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const wallet = new ethers.Wallet(TEST_KEY);
const NET = 'eip155:8453';
const signer = () => createEip3009OutboundSigner({ wallet, now: () => 1_700_000_000 });

test('produces a REAL signature that recovers to the wallet (protocol-correct)', async () => {
  const { payment, from } = await signer().sign({ payTo: '0x000000000000000000000000000000000000dEaD', amount: '1000', network: NET, nonce: 'tx1:SETTLE_IN' });
  assert.equal(from, wallet.address);
  const a = payment.payload.authorization;
  const domain = { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' };
  const recovered = ethers.verifyTypedData(domain, authorizationTypes, a, payment.payload.signature);
  assert.equal(recovered.toLowerCase(), wallet.address.toLowerCase(), 'signature does not recover to signer');
});

test('authorization is exact: from=wallet, to=payTo, value=amount, time-bounded', async () => {
  const { payment } = await signer().sign({ payTo: '0x000000000000000000000000000000000000dEaD', amount: '1000', network: NET, nonce: 'k' });
  const a = payment.payload.authorization;
  assert.equal(a.from.toLowerCase(), wallet.address.toLowerCase());
  assert.equal(a.to, '0x000000000000000000000000000000000000dEaD');
  assert.equal(a.value, '1000');            // exactly the quoted cost, never more
  assert.equal(a.validAfter, '0');
  assert.equal(a.validBefore, String(1_700_000_000 + 300));
  assert.equal(payment.scheme, 'exact');
  assert.equal(payment.network, NET);
});

test('replay-safe: same idemKey -> identical nonce and signature (on-chain single-use)', async () => {
  const s = signer();
  const a = await s.sign({ payTo: '0x00000000000000000000000000000000deadbeef', amount: '1000', network: NET, nonce: 'same-key' });
  const b = await s.sign({ payTo: '0x00000000000000000000000000000000deadbeef', amount: '1000', network: NET, nonce: 'same-key' });
  assert.equal(a.ref, b.ref);
  assert.equal(a.ref, nonceFromIdemKey('same-key'));
  assert.equal(a.payment.payload.signature, b.payment.payload.signature); // identical -> EIP-3009 nonce reuse => second on-chain settle fails
});

test('distinct idemKeys -> distinct nonces', async () => {
  const s = signer();
  const a = await s.sign({ payTo: '0x00000000000000000000000000000000deadc0de', amount: '1', network: NET, nonce: 'k1' });
  const b = await s.sign({ payTo: '0x00000000000000000000000000000000deadc0de', amount: '1', network: NET, nonce: 'k2' });
  assert.notEqual(a.ref, b.ref);
});

test('no key leakage: signer output never contains the private key', async () => {
  const { payment, ref, from } = await signer().sign({ payTo: '0x00000000000000000000000000000000deadc0de', amount: '1', network: NET, nonce: 'k' });
  const blob = JSON.stringify({ payment, ref, from });
  assert.ok(!blob.includes(TEST_KEY), 'private key leaked into output');
  assert.ok(!blob.includes(TEST_KEY.slice(2)), 'private key (no 0x) leaked into output');
});

test('rejects an unknown network (no stablecoin domain)', async () => {
  await assert.rejects(() => signer().sign({ payTo: '0x00000000000000000000000000000000deadc0de', amount: '1', network: 'eip155:999999', nonce: 'k' }), /no stablecoin domain/);
});

test('constructor rejects a non-signer', () => {
  assert.throws(() => createEip3009OutboundSigner({ wallet: {} }), /ethers Wallet\/Signer/);
});
