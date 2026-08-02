/**
 * Mapping between the Authorization aggregate (root + nonce entities) and its
 * row shapes. Shared by both repository implementations. BIGINT columns come
 * back from pg as strings; timestamps are coerced to number (integer ms) and
 * amounts to bigint.
 */

import {
  Authorization,
  AuthorizationId,
  PrincipalId,
  FundingSourceId,
  Cap,
  ConsumedAmount,
  ValidityWindow,
  SignatureEnvelope,
  NonceValue,
  AuthorizationState,
} from '@satelink/financial-domain';
import type { AuthorizationNonceInput, NonceStateValue } from '@satelink/financial-domain';
import { Money, Currency } from '@satelink/kernel';
import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';
import { repositoryError } from '../../application/ports/repository-errors.js';
import type { RepositoryError } from '../../application/ports/repository-errors.js';

export interface AuthorizationRow {
  id: string;
  principal_id: string;
  funding_source_id: string;
  cap_amount: string;
  currency: string;
  consumed_amount: string;
  valid_after: number | string;
  valid_before: number | string;
  signature_envelope: { scheme: string; signature: string; signer: string };
  state: string;
  version: number;
}

export interface NonceRow {
  authorization_id: string;
  nonce_value: string;
  valid_after: number | string;
  valid_before: number | string;
  state: string;
  consumed_amount: string | null;
  consumed_at: number | string | null;
}

export function authorizationToRow(a: Authorization): AuthorizationRow {
  return {
    id: a.id.value,
    principal_id: a.principalId.value,
    funding_source_id: a.fundingSourceId.value,
    cap_amount: a.cap.money.amount.toString(),
    currency: a.currency.code,
    consumed_amount: a.consumed.money.amount.toString(),
    valid_after: a.window.validAfter,
    valid_before: a.window.validBefore,
    signature_envelope: a.signature.toJSON(),
    state: a.state.value,
    version: a.version,
  };
}

export function noncesToRows(a: Authorization): NonceRow[] {
  return a.nonces.map((n) => ({
    authorization_id: a.id.value,
    nonce_value: n.value.value,
    valid_after: n.window.validAfter,
    valid_before: n.window.validBefore,
    state: n.state,
    consumed_amount: n.consumedAmount ? n.consumedAmount.amount.toString() : null,
    consumed_at: n.consumedAt ?? null,
  }));
}

export function rowsToAuthorization(
  row: AuthorizationRow,
  nonceRows: readonly NonceRow[],
): Result<Authorization, RepositoryError> {
  const id = AuthorizationId.of(row.id);
  if (id.isErr) return err(repositoryError(id.error.toString()));
  const principalId = PrincipalId.of(row.principal_id);
  if (principalId.isErr) return err(repositoryError(principalId.error.toString()));
  const fundingSourceId = FundingSourceId.of(row.funding_source_id);
  if (fundingSourceId.isErr) return err(repositoryError(fundingSourceId.error.toString()));
  const currency = Currency.of(row.currency);
  if (currency.isErr) return err(repositoryError(currency.error.toString()));
  const state = AuthorizationState.of(row.state);
  if (state.isErr) return err(repositoryError(state.error.toString()));

  let capAmount: bigint;
  let consumedAmount: bigint;
  try {
    capAmount = BigInt(row.cap_amount);
    consumedAmount = BigInt(row.consumed_amount);
  } catch (cause) {
    return err(repositoryError('invalid numeric amount on authorization', cause));
  }

  const cap = Cap.of(Money.fromMinorUnits(capAmount, currency.value));
  if (cap.isErr) return err(repositoryError(cap.error.toString()));
  const consumed = ConsumedAmount.of(Money.fromMinorUnits(consumedAmount, currency.value));
  if (consumed.isErr) return err(repositoryError(consumed.error.toString()));
  const window = ValidityWindow.of(Number(row.valid_after), Number(row.valid_before));
  if (window.isErr) return err(repositoryError(window.error.toString()));
  const signature = SignatureEnvelope.of(
    row.signature_envelope.scheme,
    row.signature_envelope.signature,
    row.signature_envelope.signer,
  );
  if (signature.isErr) return err(repositoryError(signature.error.toString()));

  const nonces: AuthorizationNonceInput[] = [];
  for (const nr of nonceRows) {
    const value = NonceValue.of(nr.nonce_value);
    if (value.isErr) return err(repositoryError(value.error.toString()));
    const nonceWindow = ValidityWindow.of(Number(nr.valid_after), Number(nr.valid_before));
    if (nonceWindow.isErr) return err(repositoryError(nonceWindow.error.toString()));
    let consumedMoney: Money | undefined;
    if (nr.consumed_amount !== null) {
      try {
        consumedMoney = Money.fromMinorUnits(BigInt(nr.consumed_amount), currency.value);
      } catch (cause) {
        return err(repositoryError('invalid nonce consumed_amount', cause));
      }
    }
    nonces.push({
      value: value.value,
      window: nonceWindow.value,
      state: nr.state as NonceStateValue,
      consumedAmount: consumedMoney,
      consumedAt: nr.consumed_at === null ? undefined : Number(nr.consumed_at),
    });
  }

  return ok(
    Authorization.reconstitute({
      id: id.value,
      principalId: principalId.value,
      fundingSourceId: fundingSourceId.value,
      cap: cap.value,
      consumed: consumed.value,
      window: window.value,
      signature: signature.value,
      state: state.value,
      version: row.version,
      nonces,
    }),
  );
}
