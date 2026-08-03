import { Draw } from '@satelink/financial-domain';
import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';
import type { DrawRepository } from '../../../application/ports/draw-repository.js';
import type { RepositoryError, WriteError } from '../../../application/ports/repository-errors.js';
import { repositoryError, staleVersionError } from '../../../application/ports/repository-errors.js';

export class InMemoryDrawRepository implements DrawRepository {
  private readonly store = new Map<string, Draw>();

  async findById(id: string): Promise<Result<Draw | null, RepositoryError>> {
    const d = this.store.get(id);
    return ok(d ?? null);
  }

  async findByIdempotencyKey(key: string): Promise<Result<Draw | null, RepositoryError>> {
    for (const d of this.store.values()) {
      if (d.idempotencyKey === key) {
        return ok(d);
      }
    }
    return ok(null);
  }

  async save(draw: Draw): Promise<Result<void, WriteError>> {
    const existingKey = await this.findByIdempotencyKey(draw.idempotencyKey);
    if (existingKey.isOk && existingKey.value && existingKey.value.id.value !== draw.id.value) {
      return err(repositoryError('duplicate idempotency_key'));
    }

    const existing = this.store.get(draw.id.value);
    if (!existing && draw.version === 0) {
      // Insert
      const d = (draw as any).props ? Draw.reconstitute({ ...(draw as any).props, version: 1 }) : draw;
      this.store.set(draw.id.value, d);
      return ok(undefined);
    }
    
    if (existing && existing.version === draw.version) {
      // Update
      const d = (draw as any).props ? Draw.reconstitute({ ...(draw as any).props, version: draw.version + 1 }) : draw;
      this.store.set(draw.id.value, d);
      return ok(undefined);
    }
    
    return err(staleVersionError(draw.id.value, draw.version));
  }

  async findStuckSettlements(olderThan: Date): Promise<Result<Draw[], RepositoryError>> {
    const stuck: Draw[] = [];
    for (const d of this.store.values()) {
      if (d.state.value === 'settling' && d.createdAt < olderThan.getTime()) {
        stuck.push(d);
      }
    }
    return ok(stuck);
  }
}
