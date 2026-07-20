// Routing policies — weighted scoring profiles (Constitution §6).
//
// A policy is ONLY a weight vector over scoring dimensions. It contains no
// selection logic; the DecisionEngine applies it deterministically. Weights are
// normalized to sum to 1 by the engine, so `balanced` = equal weight per dim.

export const DIMENSIONS = Object.freeze([
  'price',
  'latency',
  'availability',
  'reputation',
  'historicalSuccess',
  'paymentCompatibility',
  'settlementCompatibility',
  'risk',
]);

export const Policies = Object.freeze({
  cheapest: { name: 'cheapest', weights: { price: 1 } },
  lowestLatency: { name: 'lowestLatency', weights: { latency: 1 } },
  highestReputation: { name: 'highestReputation', weights: { reputation: 1 } },
  balanced: {
    name: 'balanced',
    weights: {
      price: 1, latency: 1, availability: 1, reputation: 1,
      historicalSuccess: 1, paymentCompatibility: 1, settlementCompatibility: 1, risk: 1,
    },
  },
});

export function getPolicy(name) {
  const p = Policies[name];
  if (!p) throw new Error(`unknown policy '${name}'`);
  return p;
}
