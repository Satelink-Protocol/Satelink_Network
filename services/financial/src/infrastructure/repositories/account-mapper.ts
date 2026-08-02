/**
 * Mapping between the Account aggregate and its persisted row shape. Shared by
 * both repository implementations.
 */

import {
  Account,
  AccountId,
  AccountKind,
  Normality,
  BalanceInvariant,
  AccountState,
  PrincipalId,
} from '@satelink/financial-domain';
import { Currency } from '@satelink/kernel';
import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';
import { repositoryError } from '../../application/ports/repository-errors.js';
import type { RepositoryError } from '../../application/ports/repository-errors.js';

export interface AccountRow {
  id: string;
  principal_id: string;
  kind: string;
  normality: string;
  currency: string;
  decimals: number;
  balance_invariant: string | null;
  state: string;
  version: number;
}

export function accountToRow(a: Account): AccountRow {
  return {
    id: a.id.value,
    principal_id: a.principalId.value,
    kind: a.kind.value,
    normality: a.normality.value,
    currency: a.currency.code,
    decimals: a.currency.decimals,
    balance_invariant: a.balanceInvariant.value,
    state: a.state.value,
    version: a.version,
  };
}

export function rowToAccount(row: AccountRow): Result<Account, RepositoryError> {
  const id = AccountId.of(row.id);
  if (id.isErr) return err(repositoryError(id.error.toString()));
  const principalId = PrincipalId.of(row.principal_id);
  if (principalId.isErr) return err(repositoryError(principalId.error.toString()));
  const kind = AccountKind.of(row.kind);
  if (kind.isErr) return err(repositoryError(kind.error.toString()));
  const normality = Normality.of(row.normality);
  if (normality.isErr) return err(repositoryError(normality.error.toString()));
  const currency = Currency.of(row.currency);
  if (currency.isErr) return err(repositoryError(currency.error.toString()));
  const state = AccountState.of(row.state);
  if (state.isErr) return err(repositoryError(state.error.toString()));

  let balanceInvariant: BalanceInvariant;
  if (row.balance_invariant === null) {
    balanceInvariant = BalanceInvariant.UNRESTRICTED;
  } else {
    const bi = BalanceInvariant.of(row.balance_invariant);
    if (bi.isErr) return err(repositoryError(bi.error.toString()));
    balanceInvariant = bi.value;
  }

  return ok(
    Account.reconstitute({
      id: id.value,
      principalId: principalId.value,
      kind: kind.value,
      normality: normality.value,
      currency: currency.value,
      balanceInvariant,
      state: state.value,
      version: row.version,
    }),
  );
}
