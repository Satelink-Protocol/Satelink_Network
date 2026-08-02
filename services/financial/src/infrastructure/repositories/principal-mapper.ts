/**
 * Mapping between the Principal aggregate and its persisted row shape. Shared by
 * the Postgres and in-memory repositories so they can never drift (the shared
 * contract suite depends on identical behaviour).
 */

import {
  Principal,
  PrincipalId,
  PrincipalKind,
  PrincipalState,
  Hierarchy,
  ExternalRef,
} from '@satelink/financial-domain';
import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';
import { repositoryError } from '../../application/ports/repository-errors.js';
import type { RepositoryError } from '../../application/ports/repository-errors.js';

export interface PrincipalRow {
  id: string;
  kind: string;
  parent_id: string | null;
  display_name: string | null;
  external_ref: string | null;
  state: string;
  metadata: Record<string, unknown> | null;
  version: number;
}

export function principalToRow(p: Principal): PrincipalRow {
  return {
    id: p.id.value,
    kind: p.kind.value,
    parent_id: p.hierarchy.parentId?.value ?? null,
    display_name: p.displayName ?? null,
    external_ref: p.externalRef?.value ?? null,
    state: p.state.value,
    metadata: p.metadata as Record<string, unknown>,
    version: p.version,
  };
}

export function rowToPrincipal(row: PrincipalRow): Result<Principal, RepositoryError> {
  const id = PrincipalId.of(row.id);
  if (id.isErr) return err(repositoryError(id.error.toString()));
  const kind = PrincipalKind.of(row.kind);
  if (kind.isErr) return err(repositoryError(kind.error.toString()));
  const state = PrincipalState.of(row.state);
  if (state.isErr) return err(repositoryError(state.error.toString()));

  let hierarchy = Hierarchy.root();
  if (row.parent_id !== null) {
    const parent = PrincipalId.of(row.parent_id);
    if (parent.isErr) return err(repositoryError(parent.error.toString()));
    hierarchy = Hierarchy.under(parent.value);
  }

  let externalRef: ExternalRef | undefined;
  if (row.external_ref !== null) {
    const ref = ExternalRef.of(row.external_ref);
    if (ref.isErr) return err(repositoryError(ref.error.toString()));
    externalRef = ref.value;
  }

  return ok(
    Principal.reconstitute({
      id: id.value,
      kind: kind.value,
      hierarchy,
      externalRef,
      displayName: row.display_name ?? undefined,
      metadata: row.metadata ?? {},
      state: state.value,
      version: row.version,
    }),
  );
}
