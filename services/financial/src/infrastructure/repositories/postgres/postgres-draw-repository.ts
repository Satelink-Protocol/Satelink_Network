import type { Pool, PoolClient } from 'pg';
import type { Draw } from '@satelink/financial-domain';
import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';
import type { DrawRepository } from '../../../application/ports/draw-repository.js';
import type { RepositoryError, WriteError } from '../../../application/ports/repository-errors.js';
import { repositoryError, staleVersionError } from '../../../application/ports/repository-errors.js';
import { drawToRow, drawToSettlementRow, rowsToDraw } from '../draw-mapper.js';
import type { DrawRow, SettlementRow } from '../draw-mapper.js';

export class PostgresDrawRepository implements DrawRepository {
  constructor(private readonly db: Pool | PoolClient) {}

  async findById(id: string): Promise<Result<Draw | null, RepositoryError>> {
    try {
      const res = await this.db.query<DrawRow>(
        'SELECT * FROM draws WHERE id = $1',
        [id]
      );
      if (res.rows.length === 0) return ok(null);
      const drawRow = res.rows[0]!;

      const sRes = await this.db.query<SettlementRow>(
        'SELECT * FROM settlements WHERE draw_id = $1',
        [id]
      );
      const sRow = sRes.rows.length > 0 ? sRes.rows[0]! : null;

      return rowsToDraw(drawRow, sRow);
    } catch (cause) {
      return err(repositoryError('findById failed', cause));
    }
  }

  async findByIdempotencyKey(key: string): Promise<Result<Draw | null, RepositoryError>> {
    try {
      const res = await this.db.query<DrawRow>(
        'SELECT * FROM draws WHERE idempotency_key = $1',
        [key]
      );
      if (res.rows.length === 0) return ok(null);
      const drawRow = res.rows[0]!;

      const sRes = await this.db.query<SettlementRow>(
        'SELECT * FROM settlements WHERE draw_id = $1',
        [drawRow.id]
      );
      const sRow = sRes.rows.length > 0 ? sRes.rows[0]! : null;

      return rowsToDraw(drawRow, sRow);
    } catch (cause) {
      return err(repositoryError('findByIdempotencyKey failed', cause));
    }
  }

  async save(draw: Draw): Promise<Result<void, WriteError>> {
    const drawRow = drawToRow(draw);
    const sRow = drawToSettlementRow(draw);
    const isPool = typeof (this.db as any).release !== 'function';

    try {
      if (draw.version === 0) {
        // Insert
        if (isPool) await this.db.query('BEGIN');
        
        try {
          await this.db.query(
            `INSERT INTO draws (
               id, principal_id, authorization_id, funding_source_id, account_id,
               amount, currency, idempotency_key, state, reject_reason, version, created_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, $11)`,
            [
              drawRow.id, drawRow.principal_id, drawRow.authorization_id, drawRow.funding_source_id,
              drawRow.account_id, drawRow.amount, drawRow.currency, drawRow.idempotency_key,
              drawRow.state, drawRow.reject_reason, drawRow.created_at
            ]
          );

          if (sRow) {
            await this.db.query(
              `INSERT INTO settlements (
                 draw_id, state, rail_tx_hash, rail_network, confirmations, required_confirmations,
                 attempt_count, confirmed_at
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                sRow.draw_id, sRow.state, sRow.rail_tx_hash, sRow.rail_network, sRow.confirmations,
                sRow.required_confirmations, sRow.attempt_count, sRow.confirmed_at
              ]
            );
          }
          if (isPool) await this.db.query('COMMIT');
          return ok(undefined);
        } catch (e) {
          if (isPool) await this.db.query('ROLLBACK');
          throw e;
        }
      } else {
        // Update
        if (isPool) await this.db.query('BEGIN');
        
        try {
          const res = await this.db.query(
            `UPDATE draws
             SET state = $1, reject_reason = $2, version = $3
             WHERE id = $4 AND version = $5`,
            [drawRow.state, drawRow.reject_reason, draw.version + 1, drawRow.id, draw.version]
          );

          if (res.rowCount === 0) {
            if (isPool) await this.db.query('ROLLBACK');
            return err(staleVersionError(draw.id.value, draw.version));
          }

          if (sRow) {
            // Upsert settlement
            await this.db.query(
              `INSERT INTO settlements (
                 draw_id, state, rail_tx_hash, rail_network, confirmations, required_confirmations,
                 attempt_count, confirmed_at
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT (draw_id) DO UPDATE SET
                 state = EXCLUDED.state,
                 rail_tx_hash = EXCLUDED.rail_tx_hash,
                 rail_network = EXCLUDED.rail_network,
                 confirmations = EXCLUDED.confirmations,
                 required_confirmations = EXCLUDED.required_confirmations,
                 attempt_count = EXCLUDED.attempt_count,
                 confirmed_at = EXCLUDED.confirmed_at`,
              [
                sRow.draw_id, sRow.state, sRow.rail_tx_hash, sRow.rail_network, sRow.confirmations,
                sRow.required_confirmations, sRow.attempt_count, sRow.confirmed_at
              ]
            );
          }
          if (isPool) await this.db.query('COMMIT');
          return ok(undefined);
        } catch (e) {
          if (isPool) await this.db.query('ROLLBACK');
          throw e;
        }
      }
    } catch (cause) {
      if (cause && (cause as any).code === '23505') { // Postgres unique_violation
        return err(repositoryError('duplicate key value violates unique constraint', cause));
      }
      return err(repositoryError('save failed', cause));
    }
  }

  async findStuckSettlements(olderThan: Date): Promise<Result<Draw[], RepositoryError>> {
    try {
      const res = await this.db.query<DrawRow>(
        'SELECT * FROM draws WHERE state = $1 AND created_at < $2',
        ['settling', olderThan.getTime()]
      );
      
      const draws: Draw[] = [];
      for (const row of res.rows) {
        const sRes = await this.db.query<SettlementRow>(
          'SELECT * FROM settlements WHERE draw_id = $1',
          [row.id]
        );
        const sRow = sRes.rows.length > 0 ? sRes.rows[0]! : null;
        const result = rowsToDraw(row, sRow);
        if (result.isErr) return err(result.error);
        draws.push(result.value);
      }
      return ok(draws);
    } catch (cause) {
      return err(repositoryError('findStuckSettlements failed', cause));
    }
  }
}
