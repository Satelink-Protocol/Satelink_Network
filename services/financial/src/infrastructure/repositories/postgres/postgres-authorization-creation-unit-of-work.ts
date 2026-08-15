/**
 * PostgresAuthorizationCreationUnitOfWork — inlines the four inserts (principal,
 * funding_source, authorization + settlement nonce, capacity account) under one
 * BEGIN/COMMIT, mirroring PostgresUnitOfWork.commitDrawAndLedger. Every insert
 * is ON CONFLICT (id) DO NOTHING so a re-submitted envelope is a no-op; the
 * authorization insert's RETURNING tells us whether anything was created.
 */

import type { Pool, PoolClient } from 'pg';
import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';
import type {
  AuthorizationCreationInput,
  AuthorizationCreationOutcome,
  AuthorizationCreationUnitOfWork,
} from '../../../application/ports/authorization-creation-unit-of-work.js';
import type { WriteError } from '../../../application/ports/repository-errors.js';
import { repositoryError } from '../../../application/ports/repository-errors.js';
import { principalToRow } from '../principal-mapper.js';
import { fundingSourceToRow } from '../funding-source-mapper.js';
import { authorizationToRow, noncesToRows } from '../authorization-mapper.js';
import { accountToRow } from '../account-mapper.js';

export class PostgresAuthorizationCreationUnitOfWork
  implements AuthorizationCreationUnitOfWork
{
  constructor(private readonly pool: Pool) {}

  async commit(
    input: AuthorizationCreationInput,
  ): Promise<Result<AuthorizationCreationOutcome, WriteError>> {
    const p = principalToRow(input.principal);
    const fs = fundingSourceToRow(input.fundingSource);
    const auth = authorizationToRow(input.authorization);
    const nonces = noncesToRows(input.authorization);
    const acct = accountToRow(input.account);

    let client: PoolClient | undefined;
    try {
      client = await this.pool.connect();
      await client.query('BEGIN');

      if (input.principalIsNew) {
        await client.query(
          `INSERT INTO principals (id, kind, parent_id, display_name, external_ref, state, metadata, version)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
           ON CONFLICT (id) DO NOTHING`,
          [
            p.id,
            p.kind,
            p.parent_id,
            p.display_name,
            p.external_ref,
            p.state,
            JSON.stringify(p.metadata ?? {}),
            p.version + 1,
          ],
        );
      }

      await client.query(
        `INSERT INTO funding_sources (id, principal_id, rail_id, rail_reference, mode, capabilities, state, version)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7,$8)
         ON CONFLICT (id) DO NOTHING`,
        [
          fs.id,
          fs.principal_id,
          fs.rail_id,
          JSON.stringify(fs.rail_reference),
          fs.mode,
          JSON.stringify(fs.capabilities),
          fs.state,
          fs.version + 1,
        ],
      );

      await client.query(
        `INSERT INTO accounts (id, principal_id, kind, normality, currency, decimals, balance_invariant, state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO NOTHING`,
        [
          acct.id,
          acct.principal_id,
          acct.kind,
          acct.normality,
          acct.currency,
          acct.decimals,
          acct.balance_invariant,
          acct.state,
        ],
      );

      const authInsert = await client.query(
        `INSERT INTO authorizations
           (id, principal_id, funding_source_id, cap_amount, currency, consumed_amount,
            valid_after, valid_before, signature_envelope, state, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [
          auth.id,
          auth.principal_id,
          auth.funding_source_id,
          auth.cap_amount,
          auth.currency,
          auth.consumed_amount,
          auth.valid_after,
          auth.valid_before,
          JSON.stringify(auth.signature_envelope),
          auth.state,
          auth.version + 1,
        ],
      );
      const created = (authInsert.rowCount ?? 0) > 0;

      // Only write the settlement nonce(s) when the authorization itself was
      // newly created; on a re-submit they already exist (UNIQUE backstop).
      if (created) {
        for (const n of nonces) {
          await client.query(
            `INSERT INTO authorization_nonces
               (authorization_id, nonce_value, valid_after, valid_before, state, consumed_amount, consumed_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (authorization_id, nonce_value) DO NOTHING`,
            [
              n.authorization_id,
              n.nonce_value,
              n.valid_after,
              n.valid_before,
              n.state,
              n.consumed_amount,
              n.consumed_at,
            ],
          );
        }
      }

      await client.query('COMMIT');
      return ok({
        created,
        principalId: p.id,
        fundingSourceId: fs.id,
        authorizationId: auth.id,
        accountId: acct.id,
      });
    } catch (cause) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* ignore */
        }
      }
      return err(repositoryError('authorization creation transaction failed', cause));
    } finally {
      client?.release();
    }
  }
}
