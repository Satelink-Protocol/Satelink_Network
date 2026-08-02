/**
 * PostgresFundingSourceRepository — maps FundingSource onto funding_sources
 * (007). Compare-and-set optimistic locking on version (as in the M4 repos).
 */

import type { Pool } from 'pg';
import type { FundingSource } from '@satelink/financial-domain';
import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';
import type { FundingSourceRepository } from '../../../application/ports/funding-source-repository.js';
import type { RepositoryError, WriteError } from '../../../application/ports/repository-errors.js';
import { repositoryError, staleVersionError } from '../../../application/ports/repository-errors.js';
import {
  fundingSourceToRow,
  rowToFundingSource,
  type FundingSourceRow,
} from '../funding-source-mapper.js';

const COLS = 'id, principal_id, rail_id, rail_reference, mode, capabilities, state, version';

export class PostgresFundingSourceRepository implements FundingSourceRepository {
  constructor(private readonly pool: Pool) {}

  async findById(id: string): Promise<Result<FundingSource | null, RepositoryError>> {
    return this.findOne(`SELECT ${COLS} FROM funding_sources WHERE id = $1`, [id]);
  }

  async findByPrincipal(principalId: string): Promise<Result<readonly FundingSource[], RepositoryError>> {
    try {
      const { rows } = await this.pool.query<FundingSourceRow>(
        `SELECT ${COLS} FROM funding_sources WHERE principal_id = $1 ORDER BY id`,
        [principalId],
      );
      const out: FundingSource[] = [];
      for (const row of rows) {
        const r = rowToFundingSource(row);
        if (r.isErr) return r;
        out.push(r.value);
      }
      return ok(out);
    } catch (cause) {
      return err(repositoryError('findByPrincipal failed', cause));
    }
  }

  async save(fundingSource: FundingSource): Promise<Result<void, WriteError>> {
    const row = fundingSourceToRow(fundingSource);
    const railRef = JSON.stringify(row.rail_reference);
    const caps = JSON.stringify(row.capabilities);
    try {
      const upd = await this.pool.query(
        `UPDATE funding_sources
            SET rail_id=$2, rail_reference=$3::jsonb, mode=$4, capabilities=$5::jsonb,
                state=$6, version=version+1
          WHERE id=$1 AND version=$7`,
        [row.id, row.rail_id, railRef, row.mode, caps, row.state, row.version],
      );
      if ((upd.rowCount ?? 0) > 0) return ok(undefined);

      const exists = await this.pool.query('SELECT 1 FROM funding_sources WHERE id=$1', [row.id]);
      if (exists.rows.length > 0) return err(staleVersionError(row.id, row.version));

      await this.pool.query(
        `INSERT INTO funding_sources (id, principal_id, rail_id, rail_reference, mode, capabilities, state, version)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7,$8)`,
        [row.id, row.principal_id, row.rail_id, railRef, row.mode, caps, row.state, row.version + 1],
      );
      return ok(undefined);
    } catch (cause) {
      return err(repositoryError('save failed', cause));
    }
  }

  private async findOne(
    sql: string,
    params: unknown[],
  ): Promise<Result<FundingSource | null, RepositoryError>> {
    try {
      const { rows } = await this.pool.query<FundingSourceRow>(sql, params);
      if (rows.length === 0) return ok(null);
      const r = rowToFundingSource(rows[0]!);
      return r.isErr ? r : ok(r.value);
    } catch (cause) {
      return err(repositoryError('query failed', cause));
    }
  }
}
