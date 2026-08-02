import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Hierarchy } from './hierarchy.js';
import { PrincipalId } from '../shared/principal-id.js';

function pid(v: string): PrincipalId {
  const r = PrincipalId.of(v);
  if (r.isErr) throw new Error(r.error.toString());
  return r.value;
}

describe('Hierarchy', () => {
  it('root has no parent', () => {
    expect(Hierarchy.root().isRoot()).toBe(true);
    expect(Hierarchy.under(pid('p1')).isRoot()).toBe(false);
  });

  it('a principal cannot be its own parent', () => {
    const r = Hierarchy.assertAcyclic(pid('p1'), pid('p1'), []);
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.tag).toBe('HierarchyCycleError');
  });

  it('a principal cannot be its own ancestor (cycle in the chain)', () => {
    // self = p1; parent = p3 whose ancestor chain is [p2, p1] -> cycle.
    const r = Hierarchy.assertAcyclic(pid('p1'), pid('p3'), [pid('p2'), pid('p1')]);
    expect(r.isErr).toBe(true);
  });

  it('a fresh id under an unrelated parent is acyclic', () => {
    const r = Hierarchy.assertAcyclic(pid('p9'), pid('p3'), [pid('p2'), pid('p1')]);
    expect(r.isOk).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PROPERTY: acyclicity holds for ANY parent chain. assertAcyclic is Ok iff self
// is neither the parent nor any of the parent's ancestors.
// ---------------------------------------------------------------------------

describe('Hierarchy — property: acyclic under any parent chain', () => {
  it('Ok iff self is not the parent and not among the parent ancestors [10000 runs]', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 0, max: 20 }),
        fc.array(fc.integer({ min: 0, max: 20 }), { maxLength: 8 }),
        (self, parent, ancestors) => {
          const selfId = pid(`p${self}`);
          const parentId = pid(`p${parent}`);
          const chain = ancestors.map((n) => pid(`p${n}`));

          const expectedCycle = self === parent || ancestors.includes(self);
          const r = Hierarchy.assertAcyclic(selfId, parentId, chain);
          expect(r.isOk).toBe(!expectedCycle);
        },
      ),
      { numRuns: 10_000 },
    );
  });
});
