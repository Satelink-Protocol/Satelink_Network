// TreasuryLedger + InboundSettlement — the inbound revenue leg. DB-free.
// Run: `node --test test/vnext_treasury_m7.test.js`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { TreasuryLedger } from '../src/vnext/reliability/treasury_ledger.js';
import { InboundSettlement } from '../src/vnext/adapters/x402/inbound_settlement.js';
import { MemoryDurableStore, createMemoryBacking } from '../src/vnext/reliability/memory_durable_store.js';

const ledger = (backing) => new TreasuryLedger({ store: new MemoryDurableStore(backing || createMemoryBacking()), clock: () => 1 });

test('credit records revenue = amount_in - cost; balance is the spread sum', async () => {
  const t = ledger();
  const a = await t.credit({ txId: 'tx1', amountIn: '1025', cost: '1000', unit: 'USDC', txInRef: '0xabc', payer: '0xBuyer' });
  assert.equal(a.credited, true);
  assert.equal(a.spread, '25');
  await t.credit({ txId: 'tx2', amountIn: '2100', cost: '2000', unit: 'USDC', txInRef: '0xdef' });
  const totals = await t.totals('USDC');
  assert.equal(totals.count, 2);
  assert.equal(totals.gross, '3125');
  assert.equal(totals.cost, '3000');
  assert.equal(totals.spread, '125'); // net revenue
  assert.equal(await t.balance('USDC'), '125');
});

test('credit is exactly-once per txId (retry books nothing new)', async () => {
  const t = ledger();
  await t.credit({ txId: 'tx1', amountIn: '1025', cost: '1000', unit: 'USDC' });
  const again = await t.credit({ txId: 'tx1', amountIn: '1025', cost: '1000', unit: 'USDC' });
  assert.equal(again.credited, false);
  assert.equal(again.deduped, true);
  assert.equal((await t.totals('USDC')).count, 1);
});

test('refuses to book a loss (inbound below supplier cost)', async () => {
  const t = ledger();
  await assert.rejects(() => t.credit({ txId: 'tx1', amountIn: '900', cost: '1000', unit: 'USDC' }), /below supplier cost/);
});

test('revenue survives restart (durable ledger over shared backing)', async () => {
  const backing = createMemoryBacking();
  await ledger(backing).credit({ txId: 'tx1', amountIn: '1050', cost: '1000', unit: 'USDC' });
  // "restart": fresh ledger + store over the same backing
  const t2 = ledger(backing);
  assert.equal(await t2.balance('USDC'), '50');
  const dup = await t2.credit({ txId: 'tx1', amountIn: '1050', cost: '1000', unit: 'USDC' });
  assert.equal(dup.deduped, true); // still exactly-once across restart
});

test('inbound: no verifier -> fail-safe (cannot settle, never serve for free)', async () => {
  const i = new InboundSettlement({ payTo: '0xSat', network: 'eip155:8453' }); // no verifier
  const r = await i.verify('someheader', '1025', 'USDC', 'https://m/x');
  assert.equal(r.settled, false);
  assert.equal(r.reason, 'no_verifier');
});

test('inbound: challenge shape + underpaid rejection', async () => {
  let seen = null;
  const i = new InboundSettlement({ payTo: '0xSat', network: 'eip155:8453', verifier: async (args) => { seen = args; return { settled: true, amount: '1000', txRef: '0xin', payer: '0xB' }; } });
  const ch = i.challenge('1025', 'USDC', 'https://m/x');
  assert.equal(ch.accepts.maxAmountRequired, '1025');
  assert.equal(ch.accepts.payTo, '0xSat');
  // verifier reports settled amount 1000 < price 1025 -> underpaid
  const under = await i.verify('h', '1025', 'USDC', 'https://m/x');
  assert.equal(under.settled, false);
  assert.equal(under.reason, 'underpaid');
  assert.equal(seen.price, '1025');
});

test('inbound: settled amount covering price -> settled with tx ref', async () => {
  const i = new InboundSettlement({ payTo: '0xSat', verifier: async () => ({ settled: true, amount: '1025', txRef: '0xin', payer: '0xB' }) });
  const r = await i.verify('h', '1025', 'USDC', 'https://m/x');
  assert.equal(r.settled, true);
  assert.equal(r.amount, '1025');
  assert.equal(r.txRef, '0xin');
  assert.equal(r.payer, '0xB');
});
