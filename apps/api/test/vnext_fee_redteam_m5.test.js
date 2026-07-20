// M5 RED TEAM — adversarial attacks on the Fee Engine. Each test asserts the
// engine DEFENDS (rejects or safely handles); no attack may corrupt a fee.
// Run: `node --test test/vnext_fee_redteam_m5.test.js`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { FeeEngine } from '../src/vnext/fees/fee_engine.js';
import { FeeLedger } from '../src/vnext/fees/fee_ledger.js';
import { FeeError } from '../src/vnext/fees/money.js';
import { Journal } from '../src/vnext/kernel/journal.js';

const engine = new FeeEngine();
const OK = { status: 'success' };
const dec = { decisionId: 'dec' };
const settle = (over = {}) => ({ txId: 'tx', currency: 'uUSDC', payer: 'B', receiver: 'satelink', settlementMode: 'POST', baseAmount: '1000000', buyerAmount: '1000000', supplierCost: '900000', ...over });
const throwsCode = (fn, code) => {
  try { fn(); } catch (e) { assert.ok(e instanceof FeeError && e.code === code, `expected FeeError ${code}, got ${e && e.code}: ${e && e.message}`); return; }
  assert.fail(`expected FeeError ${code}, but no throw`);
};

test('attack: negative fee (config)', () => {
  throwsCode(() => engine.computeFee(dec, OK, settle(), { type: 'fixed', amount: '-100' }), 'PRECISION');
  throwsCode(() => engine.computeFee(dec, OK, settle(), { type: 'fixed', amount: -100 }), 'NEGATIVE');
});

test('attack: negative spread never produces a negative fee', () => {
  const i = engine.computeFee(dec, OK, settle({ buyerAmount: '900000', supplierCost: '1000000' }), { type: 'spread' });
  assert.equal(i.feeAmount, '0'); // clamped, not -100000
});

test('attack: overflow / very large numbers', () => {
  const big = '123456789012345678901234567890';
  const i = engine.computeFee(dec, OK, settle({ baseAmount: big }), { type: 'bps', bps: 10000 });
  assert.equal(i.feeAmount, big); // 100% of base, exact, no overflow
});

test('attack: duplicate settlement / double charge', () => {
  const ledger = new FeeLedger({ journal: new Journal(), clock: () => 1 });
  const i = engine.computeFee(dec, OK, settle(), { type: 'bps', bps: 250 });
  ledger.record(i);
  const again = ledger.record(i);
  assert.equal(again.deduped, true); // no second charge
});

test('attack: replay attack (recompute + re-record)', () => {
  const journal = new Journal();
  const ledger = new FeeLedger({ journal, clock: () => 1 });
  ledger.record(engine.computeFee(dec, OK, settle(), { type: 'bps', bps: 250 }));
  ledger.record(engine.computeFee(dec, OK, settle(), { type: 'bps', bps: 250 })); // replay
  assert.equal(journal.all().filter((e) => e.phase === 'FEE').length, 1);
});

test('attack: journal tampering is detected', () => {
  const journal = new Journal();
  const ledger = new FeeLedger({ journal, clock: () => 1 });
  ledger.record(engine.computeFee(dec, OK, settle(), { type: 'fixed', amount: '10' }));
  // tamper: mutate a recorded payload in place
  journal.all().find((e) => e.phase === 'FEE').payload.feeAmount = '999999';
  assert.equal(journal.verifyChain(), false);
});

test('attack: fee mismatch for same txId is rejected', () => {
  const ledger = new FeeLedger({ journal: new Journal(), clock: () => 1 });
  ledger.record(engine.computeFee(dec, OK, settle(), { type: 'bps', bps: 250 }));
  const different = engine.computeFee(dec, OK, settle(), { type: 'bps', bps: 500 }); // same txId, different fee
  throwsCode(() => ledger.record(different), 'FEE_MISMATCH');
});

test('attack: currency mismatch', () => {
  throwsCode(() => engine.computeFee(dec, OK, settle({ supplierCurrency: 'EUR' }), { type: 'spread' }), 'CURRENCY_MISMATCH');
  throwsCode(() => engine.computeFee(dec, OK, settle(), { type: 'bps', bps: 250, currency: 'EUR' }), 'CURRENCY_MISMATCH');
  throwsCode(() => engine.computeFee({ decisionId: 'd', chosen: { currency: 'GBP' } }, OK, settle(), { type: 'bps', bps: 250 }), 'CURRENCY_MISMATCH');
});

test('attack: precision loss / floating point input', () => {
  throwsCode(() => engine.computeFee(dec, OK, settle({ baseAmount: 25.5 }), { type: 'bps', bps: 250 }), 'PRECISION');
  throwsCode(() => engine.computeFee(dec, OK, settle({ baseAmount: '25.5' }), { type: 'bps', bps: 250 }), 'PRECISION');
  throwsCode(() => engine.computeFee(dec, OK, settle(), { type: 'percentage', percent: '2.555' }), 'PRECISION');
});

test('attack: rounding is deterministic ROUND_DOWN, no leakage in splits', () => {
  const i = engine.computeFee(dec, OK, settle({ baseAmount: '1000001' }), {
    type: 'bps', bps: 333, splits: [{ receiver: 'partner', bps: 3333 }],
  });
  const total = i.splits.reduce((s, x) => s + BigInt(x.amount), 0n);
  assert.equal(total.toString(), i.feeAmount); // exact sum, remainder to primary
});

test('attack: zero amount', () => {
  const i = engine.computeFee(dec, OK, settle({ baseAmount: '0', buyerAmount: '0', supplierCost: '0' }), { type: 'bps', bps: 250 });
  assert.equal(i.feeAmount, '0');
});

test('attack: concurrent execution (same tick) charges once', async () => {
  const journal = new Journal();
  const ledger = new FeeLedger({ journal, clock: () => 1 });
  const i = engine.computeFee(dec, OK, settle(), { type: 'bps', bps: 250 });
  await Promise.all([Promise.resolve().then(() => ledger.record(i)), Promise.resolve().then(() => ledger.record(i))]);
  assert.equal(journal.all().filter((e) => e.phase === 'FEE').length, 1);
});

test('attack: partner fee routes exactly, sums to fee', () => {
  const i = engine.computeFee(dec, OK, settle(), { type: 'bps', bps: 1000, receiver: 'satelink', splits: [{ receiver: 'partner', bps: 2000 }] });
  assert.equal(i.feeAmount, '100000'); // 10% of 1M
  const partner = i.splits.find((s) => s.receiver === 'partner').amount;
  const primary = i.splits.find((s) => s.receiver === 'satelink').amount;
  assert.equal(partner, '20000'); // 20% of fee
  assert.equal(primary, '80000');
  assert.equal(BigInt(partner) + BigInt(primary), 100000n);
});

test('attack: bps edge cases', () => {
  assert.equal(engine.computeFee(dec, OK, settle(), { type: 'bps', bps: 0 }).feeAmount, '0');
  assert.equal(engine.computeFee(dec, OK, settle(), { type: 'bps', bps: 10000 }).feeAmount, '1000000'); // 100%
  throwsCode(() => engine.computeFee(dec, OK, settle(), { type: 'bps', bps: 10001 }), 'BPS_RANGE');
  throwsCode(() => engine.computeFee(dec, OK, settle(), { type: 'bps', bps: -1 }), 'NEGATIVE');
  throwsCode(() => engine.computeFee(dec, OK, settle(), { type: 'bps', bps: '-1' }), 'PRECISION');
});

test('attack: subscription override cannot be bypassed by fee config', () => {
  const i = engine.computeFee(dec, OK, settle({ subscription: { active: true, flatAmount: '5' } }), { type: 'spread' });
  assert.equal(i.feeType, 'subscription');
  assert.equal(i.feeAmount, '5');
});

test('attack: unknown fee type rejected', () => {
  throwsCode(() => engine.computeFee(dec, OK, settle(), { type: 'siphon' }), 'CONFIG');
});
