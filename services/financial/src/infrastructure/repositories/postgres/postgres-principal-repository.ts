/**
 * PostgresPrincipalRepository — maps the Principal aggregate onto the principals
 * table (001) + the version column (006).
 *
 * save() is a compare-and-set: UPDATE ... WHERE id AND version = $expected. Zero
 * rows updated means either the row is new (INSERT) or the expected version is
 * stale (StaleVersionError) — distinguished by an existence check.
 */

import type { Pool } from 'pg';
import type { Principal } from '@satelink/financial-domain';
import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';
import type { PrincipalRepository } from '../../../application/ports/principal-repository.js';
import type { RepositoryError, WriteError } from '../../../application/ports/repository-errors.js';
import { repositoryError, staleVersionError } from '../../../application/ports/repository-errors.js';
import { principalToRow, rowToPrincipal, type PrincipalRow } from '../principal-mapper.js';

const COLS = 'id, kind, parent_id, display_name, external_ref, state, metadata, version';

export class PostgresPrincipalRepository implements PrincipalRepository {
  constructor(private readonly pool: Pool) {}

  async findById(id: string): Promise<Result<Principal | null, RepositoryError>> {
    return this.findOne(`SELECT ${COLS} FROM principals WHERE id = $1`, [id]);
  }

  async findByExternalRef(externalRef: string): Promise<Result<Principal | null, RepositoryError>> {
    return this.findOne(`SELECT ${COLS} FROM principals WHERE external_ref = $1`, [externalRef]);
  }

  async findChildren(parentId: string): Promise<Result<readonly Principal[], RepositoryError>> {
    try {
      const { rows } = await this.pool.query<PrincipalRow>(
        `SELECT ${COLS} FROM principals WHERE parent_id = $1 ORDER BY id`,
        [parentId],
      );
      const out: Principal[] = [];
      for (const row of rows) {
        const r = rowToPrincipal(row);
        if (r.isErr) return r;
        out.push(r.value);
      }
      return ok(out);
    } catch (cause) {
      return err(repositoryError('findChildren failed', cause));
    }
  }

  async save(principal: Principal): Promise<Result<void, WriteError>> {
    const row = principalToRow(principal);
    const meta = JSON.stringify(row.metadata ?? {});
    try {
      const upd = await this.pool.query(
        `UPDATE principals
            SET kind=$2, parent_id=$3, display_name=$4, external_ref=$5,
                state=$6, metadata=$7::jsonb, version=version+1
          WHERE id=$1 AND version=$8`,
        [row.id, row.kind, row.parent_id, row.display_name, row.external_ref, row.state, meta, row.version],
      );
      if ((upd.rowCount ?? 0) > 0) return ok(undefined);

      const exists = await this.pool.query('SELECT 1 FROM principals WHERE id=$1', [row.id]);
      if (exists.rows.length > 0) return err(staleVersionError(row.id, row.version));

      await this.pool.query(
        `INSERT INTO principals (id, kind, parent_id, display_name, external_ref, state, metadata, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
        [row.id, row.kind, row.parent_id, row.display_name, row.external_ref, row.state, meta, row.version + 1],
      );
      return ok(undefined);
    } catch (cause) {
      return err(repositoryError('save failed', cause));
    }
  }

  private async findOne(
    sql: string,
    params: unknown[],
  ): Promise<Result<Principal | null, RepositoryError>> {
    try {
      const { rows } = await this.pool.query<PrincipalRow>(sql, params);
      if (rows.length === 0) return ok(null);
      const r = rowToPrincipal(rows[0]!);
      return r.isErr ? r : ok(r.value);
    } catch (cause) {
      return err(repositoryError('query failed', cause));
    }
  }
}
