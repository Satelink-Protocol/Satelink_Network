/**
 * Mapping between the FundingSource aggregate and its row shape. Shared by both
 * repository implementations.
 */

import {
  FundingSource,
  FundingSourceId,
  PrincipalId,
  RailId,
  RailReference,
  FundingMode,
  Capabilities,
  FundingSourceState,
} from '@satelink/financial-domain';
import type { CapabilitiesProps } from '@satelink/financial-domain';
import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';
import { repositoryError } from '../../application/ports/repository-errors.js';
import type { RepositoryError } from '../../application/ports/repository-errors.js';

export interface FundingSourceRow {
  id: string;
  principal_id: string;
  rail_id: string;
  rail_reference: { refType: string; refValue: string };
  mode: string;
  capabilities: CapabilitiesProps;
  state: string;
  version: number;
}

export function fundingSourceToRow(fs: FundingSource): FundingSourceRow {
  return {
    id: fs.id.value,
    principal_id: fs.principalId.value,
    rail_id: fs.railId.value,
    rail_reference: { refType: fs.railReference.refType, refValue: fs.railReference.refValue },
    mode: fs.mode.value,
    capabilities: fs.capabilities.toJSON(),
    state: fs.state.value,
    version: fs.version,
  };
}

export function rowToFundingSource(row: FundingSourceRow): Result<FundingSource, RepositoryError> {
  const id = FundingSourceId.of(row.id);
  if (id.isErr) return err(repositoryError(id.error.toString()));
  const principalId = PrincipalId.of(row.principal_id);
  if (principalId.isErr) return err(repositoryError(principalId.error.toString()));
  const railId = RailId.of(row.rail_id);
  if (railId.isErr) return err(repositoryError(railId.error.toString()));
  const railReference = RailReference.of(row.rail_reference.refType, row.rail_reference.refValue);
  if (railReference.isErr) return err(repositoryError(railReference.error.toString()));
  const mode = FundingMode.of(row.mode);
  if (mode.isErr) return err(repositoryError(mode.error.toString()));
  const capabilities = Capabilities.of(row.capabilities);
  if (capabilities.isErr) return err(repositoryError(capabilities.error.toString()));
  const state = FundingSourceState.of(row.state);
  if (state.isErr) return err(repositoryError(state.error.toString()));

  return ok(
    FundingSource.reconstitute({
      id: id.value,
      principalId: principalId.value,
      railId: railId.value,
      railReference: railReference.value,
      mode: mode.value,
      capabilities: capabilities.value,
      state: state.value,
      version: row.version,
    }),
  );
}
