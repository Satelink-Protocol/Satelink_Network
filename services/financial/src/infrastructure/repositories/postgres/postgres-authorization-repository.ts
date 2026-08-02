/**
 * PostgresAuthorizationRepository — maps Authorization (root + nonces) onto
 * authorizations + authorization_nonces (007).
 *
 * findById/findByPrincipal ALWAYS load the full nonce set. save() runs in one
 * transaction: compare-and-set the root on version, then replace its nonce set.
 * A stale version rolls the whole thing back and returns StaleVersionError.
 */

import type { Pool, PoolClient } from 'pg';
import type { Authorization } from '@satelink/financial-domain';
import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';
import type { AuthorizationRepository } from '../../../application/ports/authorization-repository.js';
import type { RepositoryError, WriteError } from '../../../application/ports/repository-errors.js';
import { repositoryError, staleVersionError } from '../../../application/ports/repository-errors.js';
import {
  authorizationToRow,
  noncesToRows,
  rowsToAuthorization,
  type AuthorizationRow,
  type NonceRow,
} from '../authorization-mapper.js';

const AUTH_COLS =
  'id, principal_id, funding_source_id, cap_amount, currency, consumed_amount, valid_after, valid_before, signature_envelope, state, version';
const NONCE_COLS =
  'authorization_id, nonce_value, valid_after, valid_before, state, consumed_amount, consumed_at';

export class PostgresAuthorizationRepository implements AuthorizationRepository {
  constructor(private readonly pool: Pool) {}

  async findById(id: string): Promise<Result<Authorization | null, RepositoryError>> {
    try {
      const authRes = await this.pool.query<AuthorizationRow>(
        `SELECT ${AUTH_COLS} FROM authorizations WHERE id = $1`,
        [id],
      );
      if (authRes.rows.length === 0) return ok(null);
      const nonceRes = await this.pool.query<NonceRow>(
        `SELECT ${NONCE_COLS} FROM authorization_nonces WHERE authorization_id = $1 ORDER BY id`,
        [id],
      );
      const r = rowsToAuthorization(authRes.rows[0]!, nonceRes.rows);
      return r.isErr ? r : ok(r.value);
    } catch (cause) {
      return err(repositoryError('findById failed', cause));
    }
  }

  async findByPrincipal(principalId: string): Promise<Result<readonly Authorization[], RepositoryError>> {
    try {
      const authRes = await this.pool.query<AuthorizationRow>(
        `SELECT ${AUTH_COLS} FROM authorizations WHERE principal_id = $1 ORDER BY id`,
        [principalId],
      );
      const out: Authorization[] = [];
      for (const authRow of authRes.rows) {
        const nonceRes = await this.pool.query<NonceRow>(
          `SELECT ${NONCE_COLS} FROM authorization_nonces WHERE authorization_id = $1 ORDER BY id`,
          [authRow.id],
        );
        const r = rowsToAuthorization(authRow, nonceRes.rows);
        if (r.isErr) return r;
        out.push(r.value);
      }
      return ok(out);
    } catch (cause) {
      return err(repositoryError('findByPrincipal failed', cause));
    }
  }

  async save(authorization: Authorization): Promise<Result<void, WriteError>> {
    const row = authorizationToRow(authorization);
    const sig = JSON.stringify(row.signature_envelope);
    const nonces = noncesToRows(authorization);
    let client: PoolClient | undefined;
    try {
      client = await this.pool.connect();
      await client.query('BEGIN');

      const upd = await client.query(
        `UPDATE authorizations
            SET consumed_amount=$2, state=$3, version=version+1
          WHERE id=$1 AND version=$4`,
        [row.id, row.consumed_amount, row.state, row.version],
      );

      let isInsert = false;
      if ((upd.rowCount ?? 0) === 0) {
        const exists = await client.query('SELECT 1 FROM authorizations WHERE id=$1', [row.id]);
        if (exists.rows.length > 0) {
          await client.query('ROLLBACK');
          return err(staleVersionError(row.id, row.version));
        }
        isInsert = true;
        await client.query(
          `INSERT INTO authorizations
             (id, principal_id, funding_source_id, cap_amount, currency, consumed_amount,
              valid_after, valid_before, signature_envelope, state, version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)`,
          [
            row.id, row.principal_id, row.funding_source_id, row.cap_amount, row.currency,
            row.consumed_amount, row.valid_after, row.valid_before, sig, row.state, row.version + 1,
          ],
        );
      }

      // Replace the nonce set (small, always loaded/saved with the root).
      if (!isInsert) {
        await client.query('DELETE FROM authorization_nonces WHERE authorization_id=$1', [row.id]);
      }
      for (const n of nonces) {
        await client.query(
          `INSERT INTO authorization_nonces
             (authorization_id, nonce_value, valid_after, valid_before, state, consumed_amount, consumed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [n.authorization_id, n.nonce_value, n.valid_after, n.valid_before, n.state, n.consumed_amount, n.consumed_at],
        );
      }

      await client.query('COMMIT');
      return ok(undefined);
    } catch (cause) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* ignore */
        }
      }
      return err(repositoryError('save failed', cause));
    } finally {
      client?.release();
    }
  }
}
