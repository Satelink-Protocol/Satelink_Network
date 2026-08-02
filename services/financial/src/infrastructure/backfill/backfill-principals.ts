/**
 * Backfill — create one Principal (and a capacity Account) per distinct external
 * identity found in revenue_events_v2.client_id and api_deposits.from_address.
 *
 * PROPERTIES:
 *   - READ-ONLY milestone: nothing consumes these for a decision yet.
 *   - IDEMPOTENT: keyed on external_ref (partial unique index on principals);
 *     re-running creates nothing new. Ids are also derived deterministically.
 *   - DRY-RUN by default: reads and classifies, but writes ONLY with { apply:true }.
 *   - Founder wallets (0x5cbda3…, 0x966e1a…) are flagged in metadata so they
 *     stay excluded from external revenue metrics (#10).
 *
 * Kind inference: 0x-wallet -> machine; sk_ key -> agent; 'public'/empty -> skip;
 * anything else -> skip (unrecognized), reported with a reason.
 */

import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import {
  Principal,
  PrincipalId,
  PrincipalKind,
  ExternalRef,
  Account,
  AccountId,
  AccountKind,
  Normality,
  BalanceInvariant,
} from '@satelink/financial-domain';
import { USDT } from '@satelink/kernel';
import type { Result } from '@satelink/kernel';
import { PostgresPrincipalRepository } from '../repositories/postgres/postgres-principal-repository.js';
import { PostgresAccountRepository } from '../repositories/postgres/postgres-account-repository.js';

export interface BackfillOptions {
  readonly apply: boolean;
}

export interface BackfillReport {
  readonly dryRun: boolean;
  readonly identitiesScanned: number;
  readonly principalsCreated: number;
  readonly accountsCreated: number;
  readonly founderFlagged: string[];
  readonly skipped: Array<{ identity: string; reason: string }>;
}

const WALLET_RE = /^0x[0-9a-f]{40}$/i;
const FOUNDER_PREFIXES = ['0x5cbda3', '0x966e1a'];

function normalize(identity: string): string {
  return WALLET_RE.test(identity) ? identity.toLowerCase() : identity;
}

function classifyKind(identity: string): PrincipalKind | null {
  if (WALLET_RE.test(identity)) return PrincipalKind.MACHINE;
  if (identity.startsWith('sk_')) return PrincipalKind.AGENT;
  return null;
}

function deterministicId(prefix: string, externalRef: string): string {
  const hash = createHash('sha256').update(externalRef).digest('hex').slice(0, 40);
  return `${prefix}_${hash}`;
}

function unwrap<T, E extends { toString(): string }>(r: Result<T, E>): T {
  if (r.isErr) throw new Error(r.error.toString());
  return r.value;
}

async function collectIdentities(pool: Pool): Promise<{ ids: string[]; sourceErrors: string[] }> {
  const set = new Set<string>();
  const sourceErrors: string[] = [];

  try {
    const { rows } = await pool.query<{ client_id: string | null }>(
      'SELECT DISTINCT client_id FROM revenue_events_v2',
    );
    for (const r of rows) {
      if (r.client_id != null && r.client_id !== '') set.add(normalize(String(r.client_id)));
    }
  } catch (e) {
    sourceErrors.push(`revenue_events_v2: ${(e as Error).message}`);
  }

  try {
    const { rows } = await pool.query<{ from_address: string | null }>(
      'SELECT DISTINCT from_address FROM api_deposits WHERE from_address IS NOT NULL',
    );
    for (const r of rows) {
      if (r.from_address != null && r.from_address !== '') set.add(normalize(String(r.from_address)));
    }
  } catch (e) {
    sourceErrors.push(`api_deposits: ${(e as Error).message}`);
  }

  return { ids: [...set].sort(), sourceErrors };
}

export async function runBackfill(pool: Pool, opts: BackfillOptions): Promise<BackfillReport> {
  const principalRepo = new PostgresPrincipalRepository(pool);
  const accountRepo = new PostgresAccountRepository(pool);

  const skipped: Array<{ identity: string; reason: string }> = [];
  const founderFlagged: string[] = [];
  let principalsCreated = 0;
  let accountsCreated = 0;

  const { ids, sourceErrors } = await collectIdentities(pool);
  for (const e of sourceErrors) skipped.push({ identity: '(source)', reason: e });

  for (const identity of ids) {
    if (identity === 'public') {
      skipped.push({ identity, reason: 'anonymous_public' });
      continue;
    }
    const kind = classifyKind(identity);
    if (kind === null) {
      skipped.push({ identity, reason: 'unrecognized_identity_format' });
      continue;
    }

    // Idempotency: skip if a principal already exists for this external_ref.
    const existing = await principalRepo.findByExternalRef(identity);
    if (existing.isErr) {
      skipped.push({ identity, reason: `lookup_failed: ${existing.error.message}` });
      continue;
    }
    if (existing.value !== null) {
      skipped.push({ identity, reason: 'already_exists' });
      continue;
    }

    const isFounder =
      kind.equals(PrincipalKind.MACHINE) && FOUNDER_PREFIXES.some((p) => identity.startsWith(p));

    const principalIdStr = deterministicId('prn', identity);
    const principal = unwrap(
      Principal.create({
        id: unwrap(PrincipalId.of(principalIdStr)),
        kind,
        externalRef: unwrap(ExternalRef.of(identity)),
        metadata: isFounder
          ? { source: 'backfill', founder: true, is_test_data: true }
          : { source: 'backfill' },
      }),
    );
    const activated = principal.activate();
    const toSave = activated.isOk ? activated.value : principal;

    if (opts.apply) {
      const saved = await principalRepo.save(toSave);
      if (saved.isErr) {
        skipped.push({ identity, reason: `principal_save_failed: ${saved.error.tag}` });
        continue;
      }
    }
    principalsCreated++;
    if (isFounder) founderFlagged.push(identity);

    const account = unwrap(
      Account.create({
        id: unwrap(AccountId.of(deterministicId('acct', identity))),
        principalId: unwrap(PrincipalId.of(principalIdStr)),
        kind: AccountKind.CAPACITY,
        normality: Normality.CREDIT,
        currency: USDT,
        balanceInvariant: BalanceInvariant.NON_NEGATIVE,
      }),
    );
    if (opts.apply) {
      const savedA = await accountRepo.save(account);
      if (savedA.isErr) {
        skipped.push({ identity, reason: `account_save_failed: ${savedA.error.tag}` });
        continue;
      }
    }
    accountsCreated++;
  }

  return {
    dryRun: !opts.apply,
    identitiesScanned: ids.length,
    principalsCreated,
    accountsCreated,
    founderFlagged,
    skipped,
  };
}
