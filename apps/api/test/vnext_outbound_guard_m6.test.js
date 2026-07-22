// OutboundGuard — hard financial safety rail for outbound payments. DB-free
// (memory store). Covers kill switch, per-tx/hour/day caps, wallet floor,
// exactly-once, durable-across-restart, and settlement-adapter integration
// (dry-run / fail-safe-no-signer / real spend with a mock signer).
// Run: `node --test test/vnext_outbound_guard_m6.test.js`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { OutboundGuard } from '../src/vnext/reliability/outbound_guard.js';
import { MemoryDurableStore, createMemoryBacking } from '../src/vnext/reliability/memory_durable_store.js';
import { X402SettlementAdapter } from '../src/vnext/adapters/x402/x402_settlement_adapter.js';
import { X402Context } from '../src/vnext/adapters/x402/x402_context.js';

const store = () => new MemoryDurableStore(createMemoryBacking());
const clockOf = (s) => () => s.t;

test('kill switch off: not authorized, dryRun (no money), nothing recorded', async () => {
  const g = new OutboundGuard({ store: store(), enabled: false, caps: { maxPerTx: '1000' }, clock: () => 1 });
  const d = await g.authorize('500', 'tx:SETTLE_IN');
  assert.equal(d.authorized, false);
  assert.equal(d.dryRun, true);
  assert.equal(d.reason, 'kill_switch_off');
});

test('per-tx cap blocks an oversized payment', async () => {
  const g = new OutboundGuard({ store: store(), enabled: true, caps: { maxPerTx: '1000' }, clock: () => 1 });
  assert.equal((await g.authorize('1000', 'a')).authorized, true);
  const over = await g.authorize('1001', 'b');
  assert.equal(over.authorized, false);
  assert.equal(over.reason, 'per_tx_cap');
});

test('rolling per-hour and per-day caps block cumulative overspend', async () => {
  const s = store(); const st = { t: 10_000_000 };
  const g = new OutboundGuard({ store: s, enabled: true, caps: { maxPerHour: '100', maxPerDay: '150' }, clock: clockOf(st) });
  // spend 60 now
  assert.equal((await g.authorize('60', 'p1')).authorized, true);
  await g.commit('60', 'p1', 'r1');
  // +50 within the hour would exceed 100 -> blocked
  assert.equal((await g.authorize('50', 'p2')).reason, 'per_hour_cap');
  // move 2 hours ahead: hour window resets, but day cap (150) still applies
  st.t += 2 * 3_600_000;
  assert.equal((await g.authorize('60', 'p3')).authorized, true); // hour ok (0 in last hour)
  await g.commit('60', 'p3', 'r3'); // day total now 120
  assert.equal((await g.authorize('40', 'p4')).reason, 'per_day_cap'); // 120+40 > 150
  assert.equal((await g.authorize('30', 'p5')).authorized, true);      // 120+30 = 150 ok
});

test('wallet floor: refuses when balance unknown; enforces when balance provided', async () => {
  const s1 = store();
  const noReader = new OutboundGuard({ store: s1, enabled: true, caps: { walletFloor: '100' }, clock: () => 1 });
  assert.equal((await noReader.authorize('10', 'a')).reason, 'wallet_balance_unknown'); // fail-safe

  const s2 = store();
  const withReader = new OutboundGuard({ store: s2, enabled: true, caps: { walletFloor: '100' }, balanceReader: async () => '150', clock: () => 1 });
  assert.equal((await withReader.authorize('50', 'b')).authorized, true);   // 150-50=100 >= floor
  assert.equal((await withReader.authorize('51', 'c')).reason, 'wallet_floor'); // 150-51=99 < 100
});

test('exactly-once: a re-authorized idemKey is deduped (no new spend)', async () => {
  const s = store();
  const g = new OutboundGuard({ store: s, enabled: true, caps: { maxPerDay: '100' }, clock: () => 1 });
  await g.commit('80', 'k', 'ref1'); // committed spend = 80
  const again = await g.authorize('80', 'k');
  assert.equal(again.authorized, true);
  assert.equal(again.deduped, true);
  // Only COMMITTED spend counts toward caps: 80 committed + 20 = 100 ok; +21 over.
  assert.equal((await g.authorize('20', 'k2')).authorized, true);
  assert.equal((await g.authorize('21', 'k3')).reason, 'per_day_cap');
});

test('spend() is atomic: concurrent near-limit spends cannot overshoot the cap', async () => {
  const g = new OutboundGuard({ store: store(), enabled: true, caps: { maxPerDay: '100' }, clock: () => 1 });
  const sign = (r) => async () => ({ ref: r, payment: {} });
  // Three 60-unit payments fired concurrently; cap is 100. Without the mutex,
  // all three would read committed=0 and overspend to 180.
  const results = await Promise.all([
    g.spend('60', 'a', sign('ra')),
    g.spend('60', 'b', sign('rb')),
    g.spend('60', 'c', sign('rc')),
  ]);
  const spent = results.filter((r) => r.status === 'spent').length;
  const blocked = results.filter((r) => r.status === 'blocked').length;
  assert.equal(spent, 1, 'more than one 60-unit payment cleared a 100 cap');
  assert.equal(blocked, 2);
});

test('caps survive restart (durable ledger over shared backing)', async () => {
  const backing = createMemoryBacking(); const st = { t: 5_000_000 };
  let g = new OutboundGuard({ store: new MemoryDurableStore(backing), enabled: true, caps: { maxPerDay: '100' }, clock: clockOf(st) });
  await g.commit('90', 'k', 'r');
  // "restart": new guard + store over the same backing
  g = new OutboundGuard({ store: new MemoryDurableStore(backing), enabled: true, caps: { maxPerDay: '100' }, clock: clockOf(st) });
  assert.equal((await g.authorize('20', 'k2')).reason, 'per_day_cap'); // 90 persisted + 20 > 100
  assert.equal((await g.authorize('10', 'k3')).authorized, true);
});

// ---- settlement adapter integration ----
function ctxAdapter(extra) { const ctx = new X402Context(); return { ctx, a: new X402SettlementAdapter({ ctx, config: { network: 'eip155:8453', payTo: '0xPay' }, ...extra }) }; }

test('adapter: no guard -> dry-run payload, moves no money (backward compatible)', async () => {
  const { a } = ctxAdapter();
  const r = await a.settleIn('1000', 'USDC', '0xB', 'tx1:SETTLE_IN');
  assert.equal(r.status, 'dry-run');
});

test('adapter: guard enabled but NO signer -> fail-safe (refuses to pay)', async () => {
  const g = new OutboundGuard({ store: store(), enabled: true, caps: { maxPerTx: '5000' }, clock: () => 1 });
  const { a } = ctxAdapter({ guard: g });
  await assert.rejects(() => a.settleIn('1000', 'USDC', '0xB', 'tx2:SETTLE_IN'), /outbound_no_signer/);
});

test('adapter: cap breach -> outbound_blocked (tx fails before any pay)', async () => {
  const g = new OutboundGuard({ store: store(), enabled: true, caps: { maxPerTx: '500' }, clock: () => 1 });
  const signer = { sign: async () => ({ payment: { signed: true }, ref: 'onchain_1' }) };
  const { a } = ctxAdapter({ guard: g, signer });
  await assert.rejects(() => a.settleIn('1000', 'USDC', '0xB', 'tx3:SETTLE_IN'), /outbound_blocked:per_tx_cap/);
});

test('adapter: enabled + signer + within caps -> real spend, recorded exactly once', async () => {
  const s = store();
  const g = new OutboundGuard({ store: s, enabled: true, caps: { maxPerTx: '5000', maxPerDay: '5000' }, clock: () => 1 });
  let signs = 0;
  const signer = { sign: async () => { signs += 1; return { payment: { signed: true }, ref: 'onchain_1' }; } };
  const { a } = ctxAdapter({ guard: g, signer });
  const r = await a.settleIn('1000', 'USDC', '0xB', 'tx4:SETTLE_IN');
  assert.equal(r.status, 'settled');
  assert.equal(r.ref, 'onchain_1');
  assert.equal(signs, 1);
  assert.ok(await s.outboundGet('tx4:SETTLE_IN'), 'spend not recorded in durable ledger');

  // Idempotent replay: same idemKey does not sign or spend again.
  const r2 = await a.settleIn('1000', 'USDC', '0xB', 'tx4:SETTLE_IN');
  assert.equal(signs, 1, 'signer called twice on replay (double spend)');
  assert.equal(r2.status, 'dry-run'); // deduped path builds payload, no new spend
});
