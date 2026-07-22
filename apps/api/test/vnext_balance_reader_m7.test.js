// USDC balance reader + guard floor integration. DB-free.
// Run: `node --test test/vnext_balance_reader_m7.test.js`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createBalanceReader } from '../src/vnext/adapters/x402/usdc_balance_reader.js';
import { OutboundGuard } from '../src/vnext/reliability/outbound_guard.js';
import { MemoryDurableStore, createMemoryBacking } from '../src/vnext/reliability/memory_durable_store.js';

const contract = (bal) => ({ balanceOf: async () => bal });

test('reads balance as minor-unit string', async () => {
  const r = createBalanceReader({ contract: contract(1_000_000n), address: '0xabc' });
  assert.equal(await r(), '1000000');
});

test('guard floor enforced with a real reader: pays above floor, blocks below', async () => {
  const store = () => new MemoryDurableStore(createMemoryBacking());
  const g1 = new OutboundGuard({ store: store(), enabled: true, caps: { walletFloor: '100' }, balanceReader: createBalanceReader({ contract: contract(150n), address: '0xw' }), clock: () => 1 });
  assert.equal((await g1.authorize('50', 'a')).authorized, true);   // 150-50=100 >= floor
  const g2 = new OutboundGuard({ store: store(), enabled: true, caps: { walletFloor: '100' }, balanceReader: createBalanceReader({ contract: contract(150n), address: '0xw' }), clock: () => 1 });
  assert.equal((await g2.authorize('51', 'b')).reason, 'wallet_floor'); // 150-51=99 < floor
});

test('read error propagates -> guard refuses (fail-safe, never pay blind)', async () => {
  const reader = createBalanceReader({ contract: { balanceOf: async () => { throw new Error('rpc down'); } }, address: '0xw' });
  const g = new OutboundGuard({ store: new MemoryDurableStore(createMemoryBacking()), enabled: true, caps: { walletFloor: '100' }, balanceReader: reader, clock: () => 1 });
  await assert.rejects(() => g.authorize('10', 'a'), /rpc down/); // error surfaces; no silent pay
});

test('constructor guards', () => {
  assert.throws(() => createBalanceReader({ contract: {}, address: '0xw' }), /balanceOf/);
  assert.throws(() => createBalanceReader({ contract: contract(1n) }), /address/);
});
