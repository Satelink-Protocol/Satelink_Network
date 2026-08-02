/**
 * Hierarchy — a Principal's place in the parent/child tree, by Id only.
 *
 * The domain is pure: it cannot walk the tree itself (that needs the
 * repository). So acyclicity is enforced as a guard that takes the parent's
 * ancestor chain (resolved by the application layer) and rejects any parent
 * assignment that would make a principal its own ancestor.
 */

import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';
import { PrincipalId } from '../shared/principal-id.js';

export class HierarchyCycleError {
  readonly tag = 'HierarchyCycleError' as const;
  constructor(readonly reason: string) {}
  toString(): string {
    return `HierarchyCycleError: ${this.reason}`;
  }
}

export class Hierarchy {
  private constructor(readonly parentId: PrincipalId | undefined) {
    Object.freeze(this);
  }

  static root(): Hierarchy {
    return new Hierarchy(undefined);
  }

  static under(parentId: PrincipalId): Hierarchy {
    return new Hierarchy(parentId);
  }

  isRoot(): boolean {
    return this.parentId === undefined;
  }

  equals(other: Hierarchy): boolean {
    if (this.parentId === undefined || other.parentId === undefined) {
      return this.parentId === other.parentId;
    }
    return this.parentId.equals(other.parentId);
  }

  /**
   * Assert that placing `selfId` under `parentId` does not create a cycle.
   * `parentAncestors` is the chain of ids from the parent upward to the root.
   * A cycle exists if self IS the parent, or self appears among the parent's
   * ancestors.
   */
  static assertAcyclic(
    selfId: PrincipalId,
    parentId: PrincipalId,
    parentAncestors: readonly PrincipalId[],
  ): Result<void, HierarchyCycleError> {
    if (selfId.equals(parentId)) {
      return err(new HierarchyCycleError('a principal cannot be its own parent'));
    }
    for (const ancestor of parentAncestors) {
      if (selfId.equals(ancestor)) {
        return err(
          new HierarchyCycleError(
            `assigning parent ${parentId.value} would make ${selfId.value} its own ancestor`,
          ),
        );
      }
    }
    return ok(undefined);
  }
}
