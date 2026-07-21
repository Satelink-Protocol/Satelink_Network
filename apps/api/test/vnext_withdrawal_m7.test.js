// Withdrawal — adversarial tests with a stub ERC-20 token (the transfer wire
// call is the only stubbed boundary; ledger/cap/dest logic is real). DB-free.
// Run: `node --test test/vnext_withdrawal_m7.test.js`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Withdrawal } from '../src/vnext/adapters/x402/withdrawal.js';
import { MemoryDurableStore, createMemoryBacking } from '../src/vnext/reliability/memory_durable_store.js';

const DEST = '0x00000000000000000000000000000000c01dc01d';
function tokenThatSends(hash = '0xWTX') { let n = 0; const t = { sends: 0, async transfer(to, amt) { t.sends += 1; t.lastTo = to; t.lastAmt = amt; return { hash, async wait() { return { hash }; } }; } }; return t; }
const W = (store, token, over = {}) => new Withdrawal({ store, token, dest: DEST, maxPerWithdrawal: '1000000', clock: () => 1, ...over });
const store = () => new MemoryDurableStore(createMemoryBacking());

test('sends to the FIXED destination for the exact amount', async () => {
  const token = tokenThatSends();
  const r = await W(store(), token).withdraw({ amount: '5000', idempotencyKey: 'w1' });
  assert.equal(r.ok, true);
  assert.equal(r.status, 'sent');
  assert.equal(r.dest, DEST);
  assert.equal(token.lastTo, DEST);        // never caller-supplied
  assert.equal(token.lastAmt, 5000n);
  assert.equal(r.ref, '0xWTX');
});

test('exactly-once: retry does not re-send', async () => {
  const token = tokenThatSends();
  const s = store();
  const w = W(s, token);
  await w.withdraw({ amount: '5000', idempotencyKey: 'w1' });
  const again = await w.withdraw({ amount: '5000', idempotencyKey: 'w1' });
  assert.equal(again.deduped, true);
  assert.equal(token.sends, 1, 'transfer ran twice for the same key (double payout)');
});

test('concurrent duplicate withdrawals send once', async () => {
  const token = tokenThatSends();
  const w = W(store(), token);
  await Promise.all([w.withdraw({ amount: '100', idempotencyKey: 'wc' }), w.withdraw({ amount: '100', idempotencyKey: 'wc' })]);
  assert.equal(token.sends, 1);
});

test('per-withdrawal cap blocks oversized payout (no transfer)', async () => {
  const token = tokenThatSends();
  const r = await W(store(), token, { maxPerWithdrawal: '1000' }).withdraw({ amount: '1001', idempotencyKey: 'wbig' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'per_withdrawal_cap');
  assert.equal(token.sends, 0);
});

test('transfer failure -> error status, not a false success', async () => {
  const token = { sends: 0, async transfer() { this.sends += 1; throw new Error('insufficient balance'); } };
  const r = await W(store(), token).withdraw({ amount: '100', idempotencyKey: 'wf' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 'error');
  assert.match(r.reason, /insufficient balance/);
});

test('rejects zero/negative and missing key; requires a real token + dest', async () => {
  await assert.rejects(() => W(store(), tokenThatSends()).withdraw({ amount: '0', idempotencyKey: 'z' }), /> 0/);
  await assert.rejects(() => W(store(), tokenThatSends()).withdraw({ amount: '100' }), /idempotencyKey/);
  assert.throws(() => new Withdrawal({ store: store(), token: {}, dest: DEST }), /transfer/);
  assert.throws(() => new Withdrawal({ store: store(), token: tokenThatSends() }), /destination/);
});
