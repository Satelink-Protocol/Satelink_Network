// M5 — Fee Engine functional + acceptance. All 8 fee types, deterministic,
// replayable, journaled. Run: `node --test test/vnext_fee_m5.test.js`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { FeeEngine } from '../src/vnext/fees/fee_engine.js';
import { FeeLedger } from '../src/vnext/fees/fee_ledger.js';
import { Journal } from '../src/vnext/kernel/journal.js'; // reuse M1

const engine = new FeeEngine();
const OK = { status: 'success' };
const decision = { decisionId: 'dec_test' };
const settle = (over = {}) => ({ txId: 'tx1', currency: 'uUSDC', payer: '0xBuyer', receiver: 'satelink', settlementMode: 'POST', baseAmount: '1000000', buyerAmount: '1000000', supplierCost: '900000', ...over });

test('zero fee', () => {
  const i = engine.computeFee(decision, OK, settle(), { type: 'zero' });
  assert.equal(i.feeAmount, '0');
  assert.equal(i.feeType, 'zero');
});

test('fixed fee', () => {
  const i = engine.computeFee(decision, OK, settle(), { type: 'fixed', amount: '25000' });
  assert.equal(i.feeAmount, '25000');
});

test('bps fee (floor)', () => {
  const i = engine.computeFee(decision, OK, settle({ baseAmount: '1000003' }), { type: 'bps', bps: 250 });
  // floor(1000003 * 250 / 10000) = floor(25000.075) = 25000
  assert.equal(i.feeAmount, '25000');
});

test('percentage fee', () => {
  const i = engine.computeFee(decision, OK, settle(), { type: 'percentage', percent: '2.5' });
  assert.equal(i.feeAmount, '25000'); // 2.5% of 1,000,000
});

test('spread fee (capture all)', () => {
  const i = engine.computeFee(decision, OK, settle(), { type: 'spread' });
  assert.equal(i.feeAmount, '100000'); // 1,000,000 - 900,000
});

test('hybrid fee (fixed + bps)', () => {
  const i = engine.computeFee(decision, OK, settle(), { type: 'hybrid', components: [{ type: 'fixed', amount: '1000' }, { type: 'bps', bps: 100 }] });
  assert.equal(i.feeAmount, '11000'); // 1000 + floor(1,000,000*100/10000=10000)
});

test('subscription override wins over configured fee', () => {
  const i = engine.computeFee(decision, OK, settle({ subscription: { active: true, flatAmount: '0' } }), { type: 'bps', bps: 250 });
  assert.equal(i.feeType, 'subscription');
  assert.equal(i.feeAmount, '0');
});

test('dynamic tiered fee', () => {
  const policy = { type: 'dynamic', tiers: [{ upTo: '500000', bps: 300 }, { upTo: null, bps: 100 }] };
  const small = engine.computeFee(decision, OK, settle({ txId: 'a', baseAmount: '400000' }), policy);
  const large = engine.computeFee(decision, OK, settle({ txId: 'b', baseAmount: '2000000' }), policy);
  assert.equal(small.feeAmount, '12000'); // 3% of 400k
  assert.equal(large.feeAmount, '20000'); // 1% of 2M
});

test('failed execution yields zero fee', () => {
  const i = engine.computeFee(decision, { status: 'failed' }, settle(), { type: 'bps', bps: 250 });
  assert.equal(i.feeAmount, '0');
  assert.equal(i.feeType, 'zero');
});

test('every fee carries human + machine explanation and auditHash', () => {
  const i = engine.computeFee(decision, OK, settle(), { type: 'bps', bps: 250 });
  assert.equal(typeof i.explanation.human, 'string');
  assert.equal(i.explanation.machine.formula ?? i.explanation.machine.rounding, 'ROUND_DOWN');
  assert.match(i.auditHash, /^fee_/);
});

test('ACCEPTANCE: same tx -> same fee -> same replay -> same journal', () => {
  const journal = new Journal();
  const ledger = new FeeLedger({ journal, clock: () => 42 });
  const policy = { type: 'bps', bps: 250 };

  const a = engine.computeFee(decision, OK, settle(), policy);
  const b = engine.computeFee(decision, OK, settle(), policy);
  assert.deepEqual(a, b);              // same tx -> identical fee
  assert.equal(a.auditHash, b.auditHash);

  const r1 = ledger.record(a);
  const r2 = ledger.record(b);         // replay -> deduped, no double charge
  assert.equal(r1.deduped, false);
  assert.equal(r2.deduped, true);
  assert.equal(journal.all().filter((e) => e.phase === 'FEE').length, 1);
  assert.equal(journal.verifyChain(), true);

  const replayed = FeeLedger.replay(journal);
  assert.deepEqual(replayed.get('tx1'), a); // journal replay reconstructs identical fee
});
