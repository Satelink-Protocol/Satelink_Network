import type { Draw } from '@satelink/financial-domain';
import type { Result } from '@satelink/kernel';
import type { RepositoryError, WriteError } from './repository-errors.js';

export interface DrawRepository {
  findById(id: string): Promise<Result<Draw | null, RepositoryError>>;
  
  /**
   * INVARIANT: Duplicate key must return the EXISTING draw, never create a second.
   */
  findByIdempotencyKey(key: string): Promise<Result<Draw | null, RepositoryError>>;

  /**
   * Save a Draw. If it's a new Draw, inserts it. If existing, updates it, checking
   * optimistic locking on the version column. Also saves the internal Settlement
   * entity atomically.
   */
  save(draw: Draw): Promise<Result<void, WriteError>>;

  /**
   * Find draws that have been in 'settling' state for longer than `olderThan`.
   */
  findStuckSettlements(olderThan: Date): Promise<Result<Draw[], RepositoryError>>;
}
