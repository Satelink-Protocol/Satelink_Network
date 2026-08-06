/**
 * Mapping between the Draw aggregate (root + settlement entity) and its row shapes.
 * Shared by both repository implementations.
 */

import {
  Draw,
  DrawId,
  DrawState,
  RejectReason,
  Settlement,
  SettlementState,
  RailTransaction,
  ConfirmationCount,
  AttemptCount,
  PrincipalId,
  AuthorizationId,
  FundingSourceId,
  AccountId,
} from '@satelink/financial-domain';
import { Money, Currency, ok, err } from '@satelink/kernel';
import type { Result } from '@satelink/kernel';
import { repositoryError } from '../../application/ports/repository-errors.js';
import type { RepositoryError } from '../../application/ports/repository-errors.js';

export interface DrawRow {
  id: string;
  principal_id: string;
  authorization_id: string;
  funding_source_id: string;
  account_id: string;
  amount: string;
  currency: string;
  idempotency_key: string;
  state: string;
  reject_reason: string | null;
  version: number;
  created_at: Date | string | number; // pg returns timestamptz as Date
}

export interface SettlementRow {
  draw_id: string;
  state: string;
  rail_tx_hash: string | null;
  rail_network: string | null;
  confirmations: number;
  required_confirmations: number;
  attempt_count: number;
  confirmed_at: string | number | null;
}

export function drawToRow(d: Draw): DrawRow {
  return {
    id: d.id.value,
    principal_id: d.principalId.value,
    authorization_id: d.authorizationId.value,
    funding_source_id: d.fundingSourceId.value,
    account_id: d.accountId.value,
    amount: d.amount.amount.toString(),
    currency: d.currency.code,
    idempotency_key: d.idempotencyKey,
    state: d.state.value,
    reject_reason: d.rejectReason?.value ?? null,
    version: d.version,
    created_at: new Date(d.createdAt),
  };
}

export function drawToSettlementRow(d: Draw): SettlementRow | null {
  const s = d._settlement;
  if (!s) return null;
  return {
    draw_id: d.id.value,
    state: s.state.value,
    rail_tx_hash: s.railTransaction?.txHash ?? null,
    rail_network: s.railTransaction?.network ?? null,
    confirmations: s.confirmations.value,
    required_confirmations: s.requiredConfirmations.value,
    attempt_count: s.attemptCount.value,
    confirmed_at: s.confirmedAt ?? null,
  };
}

export function rowsToDraw(
  drawRow: DrawRow,
  settlementRow: SettlementRow | null,
): Result<Draw, RepositoryError> {
  const id = DrawId.of(drawRow.id);
  if (id.isErr) return err(repositoryError(id.error.toString()));
  const principalId = PrincipalId.of(drawRow.principal_id);
  if (principalId.isErr) return err(repositoryError(principalId.error.toString()));
  const authorizationId = AuthorizationId.of(drawRow.authorization_id);
  if (authorizationId.isErr) return err(repositoryError(authorizationId.error.toString()));
  const fundingSourceId = FundingSourceId.of(drawRow.funding_source_id);
  if (fundingSourceId.isErr) return err(repositoryError(fundingSourceId.error.toString()));
  const accountId = AccountId.of(drawRow.account_id);
  if (accountId.isErr) return err(repositoryError(accountId.error.toString()));
  const currency = Currency.of(drawRow.currency);
  if (currency.isErr) return err(repositoryError(currency.error.toString()));
  const state = DrawState.of(drawRow.state);
  if (state.isErr) return err(repositoryError(state.error.toString()));
  
  let rejectReason: RejectReason | null = null;
  if (drawRow.reject_reason !== null) {
    const rr = RejectReason.of(drawRow.reject_reason);
    if (rr.isErr) return err(repositoryError(rr.error.toString()));
    rejectReason = rr.value;
  }

  let amountValue: bigint;
  try {
    amountValue = BigInt(drawRow.amount);
  } catch (cause) {
    return err(repositoryError('invalid numeric amount on draw', cause));
  }
  const amount = Money.fromMinorUnits(amountValue, currency.value);

  let settlement: Settlement | null = null;
  if (settlementRow) {
    const sState = SettlementState.of(settlementRow.state);
    if (sState.isErr) return err(repositoryError(sState.error.toString()));
    const reqConfs = ConfirmationCount.of(settlementRow.required_confirmations);
    if (reqConfs.isErr) return err(repositoryError(reqConfs.error.toString()));
    const confs = ConfirmationCount.of(settlementRow.confirmations);
    if (confs.isErr) return err(repositoryError(confs.error.toString()));
    const attempts = AttemptCount.of(settlementRow.attempt_count);
    if (attempts.isErr) return err(repositoryError(attempts.error.toString()));

    let railTx: RailTransaction | null = null;
    if (settlementRow.rail_tx_hash && settlementRow.rail_network) {
      const rt = RailTransaction.of(
        settlementRow.rail_tx_hash,
        settlementRow.rail_network,
        settlementRow.confirmations,
      );
      if (rt.isErr) return err(repositoryError(rt.error.toString()));
      railTx = rt.value;
    }

    settlement = Settlement.reconstitute({
      state: sState.value,
      railTransaction: railTx,
      confirmations: confs.value,
      requiredConfirmations: reqConfs.value,
      attemptCount: attempts.value,
      confirmedAt: settlementRow.confirmed_at === null ? null : Number(settlementRow.confirmed_at),
    });
  }

  return ok(
    Draw.reconstitute({
      id: id.value,
      principalId: principalId.value,
      authorizationId: authorizationId.value,
      fundingSourceId: fundingSourceId.value,
      accountId: accountId.value,
      amount,
      currency: currency.value,
      idempotencyKey: drawRow.idempotency_key,
      state: state.value,
      rejectReason,
      settlement,
      version: drawRow.version,
      createdAt: drawRow.created_at instanceof Date
        ? drawRow.created_at.getTime()
        : Number(drawRow.created_at),
    }),
  );
}
