// M3 — Routing Decision Engine. Deterministic weighted selection, journaled
// into the REUSED M1 Journal (hash chain), replay-identical, fully explainable.
// No kernel or adapter is touched. Run: `node --test test/vnext_decision_m3.test.js`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { DecisionEngine } from '../src/vnext/routing/decision_engine.js';
import { Policies, DIMENSIONS } from '../src/vnext/routing/policies.js';
import { Journal } from '../src/vnext/kernel/journal.js'; // reuse M1 journal

// Supplier A cheapest, B fastest, C highest reputation.
const SUPPLIERS = [
  { supplierId: 'A', price: 100, latencyMs: 200, reputation: 50, availability: 0.90, historicalSuccess: 0.90, riskScore: 0.10, paymentRail: 'x402', settlementMode: 'PRE' },
  { supplierId: 'B', price: 300, latencyMs: 20, reputation: 60, availability: 0.95, historicalSuccess: 0.95, riskScore: 0.10, paymentRail: 'x402', settlementMode: 'PRE' },
  { supplierId: 'C', price: 250, latencyMs: 150, reputation: 99, availability: 0.99, historicalSuccess: 0.99, riskScore: 0.05, paymentRail: 'x402', settlementMode: 'PRE' },
];

const engine = () => new DecisionEngine({ clock: () => 1700000000000 });

test('policy=cheapest selects supplier A', () => {
  const d = engine().select(SUPPLIERS, Policies.cheapest);
  assert.equal(d.chosen.supplierId, 'A');
});

test('policy=lowestLatency selects supplier B', () => {
  const d = engine().select(SUPPLIERS, Policies.lowestLatency);
  assert.equal(d.chosen.supplierId, 'B');
});

test('policy=highestReputation selects supplier C', () => {
  const d = engine().select(SUPPLIERS, Policies.highestReputation);
  assert.equal(d.chosen.supplierId, 'C');
});

test('policy=balanced selects deterministically (C) and weights sum to 1', () => {
  const d = engine().select(SUPPLIERS, Policies.balanced);
  assert.equal(d.chosen.supplierId, 'C');
  const sum = DIMENSIONS.reduce((s, dim) => s + d.policy.weights[dim], 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, 'weights must sum to 1');
  // Same inputs -> same decision (no kernel edits, no adapters involved).
  const again = engine().select(SUPPLIERS, Policies.balanced);
  assert.equal(again.decisionId, d.decisionId);
});

test('replay: journaled decision reconstructs identically from the hash chain', () => {
  const journal = new Journal();
  const decision = engine().select(SUPPLIERS, Policies.balanced);
  const txId = 'tx_m3_replay';
  journal.append(txId, 'DECISION', decision, 1700000000000);

  assert.equal(journal.verifyChain(), true);
  const persisted = journal.read(txId).find((e) => e.phase === 'DECISION').payload;
  assert.deepEqual(persisted, decision); // complete decision persisted + reconstructed

  // Determinism: recomputing from the same inputs yields the identical decision.
  const recomputed = engine().select(SUPPLIERS, Policies.balanced);
  assert.deepEqual(recomputed, decision);
});

test('explainability: decision carries id, chosen, rejected, scores, reason, confidence', () => {
  const d = engine().select(SUPPLIERS, Policies.cheapest);
  assert.match(d.decisionId, /^dec_/);
  assert.equal(typeof d.timestamp, 'number');
  assert.equal(d.chosen.supplierId, 'A');
  assert.equal(d.rejected.length, 2);
  assert.equal(d.scores.length, 3);
  // every candidate score explains all 8 dimensions
  for (const s of d.scores) for (const dim of DIMENSIONS) assert.equal(typeof s.perDimension[dim], 'number');
  assert.equal(typeof d.reason, 'string');
  assert.ok(d.confidence >= 0 && d.confidence <= 1);
});
