// Decision stores (Phase 6 item 6). trading_decisions is append-only (migration 033, 029 guard).
export class InMemoryDecisionStore {
  rows = [];
  async insert(r) { if (this.rows.some((x) => x.id === r.id)) throw new Error('duplicate decision id'); this.rows.push(structuredClone(r)); }
  async get(id) { return structuredClone(this.rows.find((r) => r.id === id) ?? null); }
}

export class PgDecisionStore {
  #pool;
  constructor(pool) { if (!pool?.query) throw new Error('PgDecisionStore needs a pg pool'); this.#pool = pool; }
  async insert(r) {
    await this.#pool.query(
      `INSERT INTO trading_decisions (id, decision, score, confidence, failed_gates, gate_details, dimension_scores, strategy_version_id,
         strategy_definition_hash, data_timestamp, expires_at, evidence_refs, explanation, config_version, input_hash, principal_id,
         instrument, side, opportunity_id, decided_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
      [r.id, r.decision, r.score, r.confidence, r.failed_gates, JSON.stringify(r.gate_details), JSON.stringify(r.dimension_scores), r.strategy_version,
        r.strategy_definition_hash, r.data_timestamp, r.expires_at, r.evidence_refs, r.explanation, r.config_version, r.input_hash, r.subject.principalId,
        r.subject.instrument, r.subject.side, r.subject.opportunityId, r.decided_at],
    );
  }
  async get(id) {
    const { rows } = await this.#pool.query('SELECT * FROM trading_decisions WHERE id = $1', [id]);
    return rows[0] ?? null;
  }
}
