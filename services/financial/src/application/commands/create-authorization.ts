/**
 * create-authorization — application command. Turns a wallet-signed x402
 * "exact" (EIP-3009) envelope into a persisted Authorization + FundingSource +
 * capacity Account for the signer's Principal, in ONE transaction.
 *
 * Order of operations (fail-closed):
 *   1. Verify the signature (recovered signer == claimed signer == message.from)
 *      and that the token/chain are the expected USDC-on-Base. An unverifiable
 *      or off-token envelope is REJECTED — nothing is persisted.
 *   2. Resolve (or mint) the signer's Principal by external_ref.
 *   3. Build FundingSource(mode=authorization), Authorization(cap=value, one
 *      settlement nonce), capacity Account(USDC, credit, non_negative).
 *   4. Commit all of it via the AuthorizationCreationUnitOfWork (idempotent on
 *      the authorization id, which is derived from the EIP-3009 nonce).
 *
 * Nonces are settlement events, not call events (see libs/CLAUDE.md M8 frozen
 * decision): the single nonce here is the on-chain redemption authorization,
 * never touched by per-call capacity metering.
 */

import {
  Principal,
  PrincipalId,
  PrincipalKind,
  ExternalRef,
  FundingSource,
  FundingSourceId,
  RailId,
  RailReference,
  FundingMode,
  Capabilities,
  Authorization,
  AuthorizationId,
  Cap,
  ValidityWindow,
  SignatureEnvelope,
  NonceValue,
  Account,
  AccountId,
  AccountKind,
  Normality,
  BalanceInvariant,
} from '@satelink/financial-domain';
import { Money, USDC } from '@satelink/kernel';
import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';
import type { EnvelopeVerifier, SignedAuthorizationEnvelope } from '../ports/envelope-verifier.js';
import type { PrincipalRepository } from '../ports/principal-repository.js';
import type { AuthorizationCreationUnitOfWork } from '../ports/authorization-creation-unit-of-work.js';

/** Canonical USDC on Base (Coinbase-issued) — the only token the x402 "exact"
 * rail settles against in production. */
export const BASE_USDC_ADDRESS = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
export const BASE_CHAIN_ID = 8453;

export class CreateAuthorizationError {
  readonly tag = 'CreateAuthorizationError' as const;
  constructor(
    readonly reason: string,
    readonly cause?: unknown,
  ) {}
  toString(): string {
    return `CreateAuthorizationError: ${this.reason}`;
  }
}

export interface CreateAuthorizationDeps {
  readonly verifier: EnvelopeVerifier;
  readonly principals: PrincipalRepository;
  readonly uow: AuthorizationCreationUnitOfWork;
  /** Defaults to Base USDC; overridable for tests / other chains. */
  readonly expected?: { readonly chainId: number; readonly usdcAddress: string };
}

export interface CreateAuthorizationView {
  readonly created: boolean;
  readonly principalId: string;
  readonly fundingSourceId: string;
  readonly authorizationId: string;
  readonly accountId: string;
  readonly signer: string;
  readonly capMinorUnits: string;
  readonly currency: string;
  readonly validAfterMs: number;
  readonly validBeforeMs: number;
  readonly nonce: string;
}

/** Deterministic ids. Authorization/funding are keyed by the EIP-3009 nonce so
 * a re-submit is idempotent; the capacity account is keyed by principal+currency
 * so one principal has exactly one USDC capacity account across authorizations. */
function nonceKey(nonce: string): string {
  return nonce.replace(/^0x/, '').slice(0, 40);
}
function principalSuffix(principalId: string): string {
  return principalId.replace(/^prn_/, '');
}

export async function createAuthorization(
  deps: CreateAuthorizationDeps,
  envelope: SignedAuthorizationEnvelope,
): Promise<Result<CreateAuthorizationView, CreateAuthorizationError>> {
  const expectedChainId = deps.expected?.chainId ?? BASE_CHAIN_ID;
  const expectedUsdc = (deps.expected?.usdcAddress ?? BASE_USDC_ADDRESS).toLowerCase();

  // 1. Verify signature authenticity — reject before any persistence.
  const verifiedRes = await deps.verifier.verify(envelope);
  if (verifiedRes.isErr) {
    return err(new CreateAuthorizationError(`signature verification failed: ${verifiedRes.error.reason}`));
  }
  const v = verifiedRes.value;
  if (v.chainId !== expectedChainId || v.verifyingContract !== expectedUsdc) {
    return err(
      new CreateAuthorizationError(
        `envelope token/chain mismatch: got ${v.verifyingContract}@${v.chainId}, expected USDC ${expectedUsdc}@${expectedChainId}`,
      ),
    );
  }

  // 2. Resolve (or mint) the signer's principal by external_ref.
  const externalRef = v.signer;
  const existingRes = await deps.principals.findByExternalRef(externalRef);
  if (existingRes.isErr) {
    return err(new CreateAuthorizationError('principal lookup failed', existingRes.error));
  }

  let principal: Principal;
  let principalIsNew: boolean;
  let principalIdStr: string;
  if (existingRes.value) {
    principal = existingRes.value;
    principalIsNew = false;
    principalIdStr = principal.id.value;
  } else {
    principalIdStr = `prn_${externalRef.replace(/^0x/, '')}`;
    const pid = PrincipalId.of(principalIdStr);
    const ref = ExternalRef.of(externalRef);
    if (pid.isErr) return err(new CreateAuthorizationError(pid.error.toString()));
    if (ref.isErr) return err(new CreateAuthorizationError(ref.error.toString()));
    const created = Principal.create({
      id: pid.value,
      kind: PrincipalKind.MACHINE,
      externalRef: ref.value,
      metadata: { source: 'm8-authorization' },
    });
    if (created.isErr) return err(new CreateAuthorizationError('principal create failed'));
    const activated = created.value.activate();
    if (activated.isErr) return err(new CreateAuthorizationError(activated.error.toString()));
    principal = activated.value;
    principalIsNew = true;
  }

  // 3. Build the ids and aggregates.
  const key = nonceKey(v.nonce);
  const fundIdRes = FundingSourceId.of(`fund_${key}`);
  const authIdRes = AuthorizationId.of(`auth_${key}`);
  const acctIdRes = AccountId.of(`acct_${principalSuffix(principalIdStr)}_usdc`);
  const principalIdRes = PrincipalId.of(principalIdStr);
  if (fundIdRes.isErr) return err(new CreateAuthorizationError(fundIdRes.error.toString()));
  if (authIdRes.isErr) return err(new CreateAuthorizationError(authIdRes.error.toString()));
  if (acctIdRes.isErr) return err(new CreateAuthorizationError(acctIdRes.error.toString()));
  if (principalIdRes.isErr) return err(new CreateAuthorizationError(principalIdRes.error.toString()));
  const principalId = principalIdRes.value;

  // FundingSource — rail_reference records the exact EIP-3009 params so the
  // settlement poller can rebuild and redeem the authorization on-chain.
  const railIdRes = RailId.of('x402-base-usdc');
  const railRefRes = RailReference.of(
    'eip3009',
    JSON.stringify({
      to: v.to,
      value: v.value.toString(),
      validAfterMs: v.validAfterMs,
      validBeforeMs: v.validBeforeMs,
      nonce: v.nonce,
      verifyingContract: v.verifyingContract,
      chainId: v.chainId,
    }),
  );
  const capsRes = Capabilities.of({
    supportsRecurring: false,
    supportsEscrow: false,
    supportsRefund: false,
    agentCompatible: true,
    settlementLatency: 'seconds',
    custodial: false,
  });
  if (railIdRes.isErr) return err(new CreateAuthorizationError(railIdRes.error.toString()));
  if (railRefRes.isErr) return err(new CreateAuthorizationError(railRefRes.error.toString()));
  if (capsRes.isErr) return err(new CreateAuthorizationError(capsRes.error.toString()));

  const fsRegistered = FundingSource.create({
    id: fundIdRes.value,
    principalId,
    railId: railIdRes.value,
    railReference: railRefRes.value,
    mode: FundingMode.AUTHORIZATION,
    capabilities: capsRes.value,
  });
  if (fsRegistered.isErr) return err(new CreateAuthorizationError('funding source create failed'));
  const fsVerified = fsRegistered.value.verify();
  if (fsVerified.isErr) return err(new CreateAuthorizationError(fsVerified.error.toString()));
  const fundingSource = fsVerified.value;

  // Authorization — cap = signed value, one SETTLEMENT nonce.
  const capRes = Cap.of(Money.fromMinorUnits(v.value, USDC));
  const windowRes = ValidityWindow.of(v.validAfterMs, v.validBeforeMs);
  const sigRes = SignatureEnvelope.of('exact', envelope.signature, v.signer);
  const nonceRes = NonceValue.of(v.nonce);
  if (capRes.isErr) return err(new CreateAuthorizationError(capRes.error.toString()));
  if (windowRes.isErr) return err(new CreateAuthorizationError(windowRes.error.toString()));
  if (sigRes.isErr) return err(new CreateAuthorizationError(sigRes.error.toString()));
  if (nonceRes.isErr) return err(new CreateAuthorizationError(nonceRes.error.toString()));

  const authRes = Authorization.create({
    id: authIdRes.value,
    principalId,
    fundingSourceId: fundIdRes.value,
    cap: capRes.value,
    window: windowRes.value,
    signature: sigRes.value,
    nonces: [{ value: nonceRes.value, window: windowRes.value }],
  });
  if (authRes.isErr) return err(new CreateAuthorizationError('authorization create failed'));
  const authorization = authRes.value;

  // Capacity account — USDC, credit-normal, non-negative (matches production
  // capacity accounts except currency, which must match the authorization).
  const accountRes = Account.create({
    id: acctIdRes.value,
    principalId,
    kind: AccountKind.CAPACITY,
    normality: Normality.CREDIT,
    currency: USDC,
    balanceInvariant: BalanceInvariant.NON_NEGATIVE,
  });
  if (accountRes.isErr) return err(new CreateAuthorizationError('account create failed'));
  const account = accountRes.value;

  // 4. One transaction, idempotent on the authorization id.
  const committed = await deps.uow.commit({
    principal,
    principalIsNew,
    fundingSource,
    authorization,
    account,
  });
  if (committed.isErr) {
    return err(new CreateAuthorizationError('commit failed', committed.error));
  }
  const out = committed.value;

  return ok({
    created: out.created,
    principalId: out.principalId,
    fundingSourceId: out.fundingSourceId,
    authorizationId: out.authorizationId,
    accountId: out.accountId,
    signer: v.signer,
    capMinorUnits: v.value.toString(),
    currency: 'USDC',
    validAfterMs: v.validAfterMs,
    validBeforeMs: v.validBeforeMs,
    nonce: v.nonce,
  });
}
