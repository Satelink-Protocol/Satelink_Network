// M4 — Supplier Registry + Health Monitor. Generic inventory, journaled
// mutations, deterministic replay, health-driven candidate filtering, and the
// frozen DecisionEngine consuming registry output UNMODIFIED.
// Run: `node --test test/vnext_registry_m4.test.js`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { SupplierRegistry, reconstructSuppliers } from '../src/vnext/registry/supplier_registry.js';
import { HealthMonitor } from '../src/vnext/registry/health_monitor.js';
import { Journal } from '../src/vnext/kernel/journal.js';          // reuse M1
import { DecisionEngine } from '../src/vnext/routing/decision_engine.js'; // reuse M3, unmodified
import { Policies } from '../src/vnext/routing/policies.js';

function harness() {
  const state = { t: 1000 };
  const clock = () => state.t;
  const journal = new Journal();
  const registry = new SupplierRegistry({ journal, clock });
  const monitor = new HealthMonitor({ registry, clock, heartbeatTimeoutMs: 100 });
  const base = (id, price, latency, rep) => ({
    supplierId: id, adapterId: 'echo-adapter', capabilities: ['echo'],
    supportedWorkloads: ['echo'], supportedSettlementModes: ['PRE'],
    supportedPaymentRails: ['x402'], supportedChains: ['eip155:8453'],
    basePrice: price, latency, reputation: rep,
  });
  for (const [id, p, l, r] of [['S1', 100, 200, 50], ['S2', 300, 20, 60], ['S3', 250, 150, 99], ['S4', 120, 90, 70], ['S5', 500, 40, 80]]) {
    registry.register(base(id, p, l, r));
  }
  return { state, clock, journal, registry, monitor };
}

test('register 5 suppliers; all routable and workload-filtered', () => {
  const { registry } = harness();
  assert.equal(registry.list().length, 5);
  assert.equal(registry.findCandidates({ workload: 'echo' }).length, 5);
  assert.equal(registry.findCandidates({ workload: 'nonexistent' }).length, 0); // candidate filtering
});

test('heartbeat updates lastHeartbeat and latency', () => {
  const { registry, state } = harness();
  state.t = 1500;
  registry.heartbeat('S1', { latency: 42 });
  const s = registry.get('S1');
  assert.equal(s.lastHeartbeat, 1500);
  assert.equal(s.latency, 42);
});

test('supplier goes offline (stale heartbeat) then returns (heartbeat)', () => {
  const { registry, monitor, state } = harness();
  // keep S1..S4 fresh, let S5 go stale
  state.t = 1180;
  for (const id of ['S1', 'S2', 'S3', 'S4']) registry.heartbeat(id);
  state.t = 1200; // fresh: 20ms since S1..S4 (1180); stale: 200ms since S5 (1000)
  const offlined = monitor.evaluate();
  assert.deepEqual(offlined, ['S5']);
  assert.equal(registry.get('S5').status, 'offline');
  assert.equal(registry.findCandidates({ workload: 'echo' }).length, 4); // S5 excluded

  registry.heartbeat('S5'); // supplier returns
  assert.equal(registry.get('S5').status, 'healthy');
  assert.equal(registry.findCandidates({ workload: 'echo' }).length, 5);
});

test('price + latency changes are reflected in candidates', () => {
  const { registry } = harness();
  registry.updatePrice('S3', { basePrice: 10 });
  registry.heartbeat('S3', { latency: 5 });
  const c = registry.findCandidates({ workload: 'echo' }).find((x) => x.supplierId === 'S3');
  assert.equal(c.price, 10);
  assert.equal(c.latencyMs, 5);
});

test('health degradation lowers availability but keeps supplier routable', () => {
  const { registry } = harness();
  registry.updateHealth('S2', { status: 'degraded', health: 'degraded' });
  const c = registry.findCandidates({ workload: 'echo' }).find((x) => x.supplierId === 'S2');
  assert.equal(c.availability, 0.5); // health change automatically affects selection input
  assert.ok(c, 'degraded supplier still a candidate');
  // maintenance removes it entirely
  registry.updateHealth('S4', { status: 'maintenance' });
  assert.ok(!registry.findCandidates({ workload: 'echo' }).some((x) => x.supplierId === 'S4'));
});

test('DecisionEngine consumes registry output WITHOUT modification', () => {
  const { registry } = harness();
  registry.updatePrice('S1', { basePrice: 5 }); // make S1 cheapest
  const candidates = registry.findCandidates({ workload: 'echo' });
  const decision = new DecisionEngine({ clock: () => 1 }).select(candidates, Policies.cheapest);
  assert.equal(decision.chosen.supplierId, 'S1');
  // and health changes flow through: take S1 offline, cheapest is now next-lowest (S4=120)
  registry.updateHealth('S1', { status: 'offline' });
  const d2 = new DecisionEngine({ clock: () => 1 }).select(registry.findCandidates({ workload: 'echo' }), Policies.cheapest);
  assert.equal(d2.chosen.supplierId, 'S4');
});

test('operator-set offline is NOT revived by a heartbeat (only stale-offline recovers)', () => {
  const { registry } = harness();
  registry.updateHealth('S1', { status: 'offline' }); // operator disables
  registry.heartbeat('S1'); // stray heartbeat must not re-enable
  assert.equal(registry.get('S1').status, 'offline');
  assert.ok(!registry.findCandidates({ workload: 'echo' }).some((x) => x.supplierId === 'S1'));
});

test('journal: every mutation journaled; replay reconstructs identical state', () => {
  const { registry, journal, monitor, state } = harness();
  registry.heartbeat('S1', { latency: 33 });
  registry.updatePrice('S2', { basePrice: 77 });
  registry.updateHealth('S3', { status: 'degraded' });
  registry.unregister('S5');
  state.t = 5000;
  monitor.evaluate(); // auto-offline the stale ones -> more journaled mutations

  assert.equal(journal.verifyChain(), true);
  const rebuilt = reconstructSuppliers(journal);
  const live = registry.snapshot();
  assert.deepEqual([...rebuilt.keys()].sort(), [...live.keys()].sort());
  for (const [id, s] of live) assert.deepEqual(rebuilt.get(id), s);
});
