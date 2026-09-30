// Market-data entitlements (Stage 11). DENY BY DEFAULT.
//
// Backed by market_data_entitlements (migration 022). A purpose is allowed only
// by an active, in-window grant for exactly that (principal, venue, dataset,
// scope). REDISTRIBUTION is never implied by INTERNAL_USE or DISPLAY.
import { Dataset, MarketDataError, Purpose } from './types.mjs';

/** Purpose → the entitlement scopes that satisfy it. */
export const SATISFYING_SCOPES = Object.freeze({
  [Purpose.INTERNAL_USE]: Object.freeze(['internal_use', 'display', 'redistribution']),
  [Purpose.DISPLAY]: Object.freeze(['display', 'redistribution']),
  [Purpose.REDISTRIBUTION]: Object.freeze(['redistribution']),
});

/** In-memory store for tests and local dev. Rows use the table's column names. */
export class InMemoryEntitlementStore {
  #rows;
  constructor(rows = []) { this.#rows = rows.map((r) => Object.freeze({ ...r })); }
  async findActive({ principalId, venue, dataset, scopes, at }) {
    const t = at.getTime();
    return this.#rows.find((r) => r.principal_id === principalId && r.venue === venue && r.dataset === dataset
      && scopes.includes(r.scope) && r.status === 'active'
      && new Date(r.valid_from).getTime() <= t && (r.valid_until == null || new Date(r.valid_until).getTime() > t)) ?? null;
  }
}

/** Postgres store (read-only query). */
export class PgEntitlementStore {
  #pool;
  constructor(pool) {
    if (!pool || typeof pool.query !== 'function') throw new MarketDataError('CONFIG', 'PgEntitlementStore requires a pg pool');
    this.#pool = pool;
  }
  async findActive({ principalId, venue, dataset, scopes, at }) {
    const r = await this.#pool.query(
      `SELECT id, principal_id, venue, dataset, scope, status, source_terms_ref, valid_from, valid_until
         FROM market_data_entitlements
        WHERE principal_id = $1 AND venue = $2 AND dataset = $3 AND scope = ANY($4::text[])
          AND status = 'active' AND valid_from <= $5 AND (valid_until IS NULL OR valid_until > $5)
        ORDER BY array_position($4::text[], scope)
        LIMIT 1`,
      [principalId, venue, dataset, scopes, at],
    );
    return r.rows[0] ?? null;
  }
}

export class EntitlementService {
  #store;
  #clock;
  constructor({ store, clock }) {
    if (!store || typeof store.findActive !== 'function') throw new MarketDataError('CONFIG', 'EntitlementService requires a store');
    if (typeof clock !== 'function') throw new MarketDataError('CONFIG', 'EntitlementService requires a clock');
    this.#store = store;
    this.#clock = clock;
  }

  /** @returns {Promise<{allowed:true, entitlementId:string, scope:string}>} or throws ENTITLEMENT_DENIED */
  async assertAllowed({ principalId, venue, dataset, purpose }) {
    if (typeof principalId !== 'string' || !principalId) throw new MarketDataError('ENTITLEMENT_DENIED', 'principalId required');
    if (!Object.values(Dataset).includes(dataset)) throw new MarketDataError('ENTITLEMENT_DENIED', `unknown dataset ${dataset}`);
    const scopes = SATISFYING_SCOPES[purpose];
    if (!scopes) throw new MarketDataError('ENTITLEMENT_DENIED', `unknown purpose ${purpose}`);
    const row = await this.#store.findActive({ principalId, venue, dataset, scopes: [...scopes], at: this.#clock() });
    if (!row) {
      throw new MarketDataError('ENTITLEMENT_DENIED', `no active ${purpose} entitlement for ${principalId} on ${venue}/${dataset}`);
    }
    return Object.freeze({ allowed: true, entitlementId: row.id, scope: row.scope });
  }
}
