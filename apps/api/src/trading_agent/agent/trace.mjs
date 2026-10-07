// Trace capture (Stage 12): agent_runs, tool_calls, model_traces (migration 023).
// Every payload is REDACTED before it reaches any store.
import { redact } from './redaction.mjs';
import { AgentError } from './errors.mjs';

export class InMemoryTraceStore {
  runs = [];
  toolCalls = [];
  modelTraces = [];
  async insertRun(r) { this.runs.push(r); }
  async finishRun(id, patch) { Object.assign(this.runs.find((r) => r.id === id), patch); }
  async insertToolCall(r) { this.toolCalls.push(r); }
  async insertModelTrace(r) { this.modelTraces.push(r); }
  /** Same contract as PgTraceStore.costBy. */
  async costBy(dimension) {
    const col = COST_DIMENSIONS[dimension];
    if (!col) throw new AgentError('CONFIG', `unknown cost dimension ${dimension}`);
    const principalOf = new Map(this.runs.map((r) => [r.id, r.principalId]));
    const agg = new Map();
    for (const t of this.modelTraces) {
      const key = dimension === 'principal' ? principalOf.get(t.runId) : t[col.field];
      if (key == null) continue;
      const a = agg.get(key) ?? { key, calls: 0, pricedCalls: 0, unpricedCalls: 0, costUsdMicro: 0n, inputTokens: 0, outputTokens: 0 };
      a.calls += 1;
      if (t.costPriced) { a.pricedCalls += 1; a.costUsdMicro += BigInt(t.costUsdMicro); } else a.unpricedCalls += 1;
      a.inputTokens += t.inputTokens ?? 0; a.outputTokens += t.outputTokens ?? 0;
      agg.set(key, a);
    }
    return [...agg.values()].sort((x, y) => String(x.key).localeCompare(String(y.key))).map((a) => ({ ...a, costUsdMicro: String(a.costUsdMicro) }));
  }
}

/** Cost aggregation dimensions → model_traces column (principal comes from agent_runs). */
export const COST_DIMENSIONS = Object.freeze({
  principal: { sql: 'r.principal_id', field: null },
  strategy: { sql: 't.strategy_id', field: 'strategyId' },
  opportunity: { sql: 't.opportunity_id', field: 'opportunityId' },
  machine_request: { sql: 't.machine_request_id', field: 'machineRequestId' },
});

export class PgTraceStore {
  #pool;
  constructor(pool) {
    if (!pool || typeof pool.query !== 'function') throw new AgentError('CONFIG', 'PgTraceStore requires a pg pool');
    this.#pool = pool;
  }
  async insertRun(r) {
    await this.#pool.query(
      `INSERT INTO agent_runs (id, principal_id, status, goal_redacted, started_at) VALUES ($1, $2, $3, $4, $5)`,
      [r.id, r.principalId, r.status, r.goal, r.startedAt],
    );
  }
  async finishRun(id, p) {
    await this.#pool.query(
      `UPDATE agent_runs SET status = $2, finished_at = $3, step_count = $4, error_redacted = $5, final_output_redacted = $6 WHERE id = $1`,
      [id, p.status, p.finishedAt, p.stepCount, p.error ?? null, p.finalOutput ?? null],
    );
  }
  async insertToolCall(r) {
    await this.#pool.query(
      `INSERT INTO tool_calls (id, run_id, seq, tool_name, tier, status, rejection_code, input_redacted, output_redacted, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [r.id, r.runId, r.seq, r.toolName, r.tier, r.status, r.rejectionCode, JSON.stringify(r.input), JSON.stringify(r.output), r.createdAt],
    );
  }
  async insertModelTrace(r) {
    await this.#pool.query(
      `INSERT INTO model_traces (id, run_id, seq, task, provider, model, status, error_code, request_redacted, response_redacted,
                                 input_tokens, output_tokens, latency_ms, created_at,
                                 tier, task_type, cache_read_tokens, cache_write_tokens, cost_usd_micro, cost_priced, price_version,
                                 strategy_id, opportunity_id, machine_request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)`,
      [r.id, r.runId, r.seq, r.task, r.provider, r.model, r.status, r.errorCode, JSON.stringify(r.request), JSON.stringify(r.response),
        r.inputTokens, r.outputTokens, r.latencyMs, r.createdAt,
        r.tier ?? null, r.taskType ?? null, r.cacheReadTokens ?? null, r.cacheWriteTokens ?? null,
        r.costUsdMicro == null ? null : String(r.costUsdMicro), r.costPriced === true, r.priceVersion ?? null,
        r.strategyId ?? null, r.opportunityId ?? null, r.machineRequestId ?? null],
    );
  }

  /** LLM cost per user / strategy / opportunity / machine request. Amounts are micro-USD strings. */
  async costBy(dimension, { since = null, until = null } = {}) {
    const col = COST_DIMENSIONS[dimension];
    if (!col) throw new AgentError('CONFIG', `unknown cost dimension ${dimension}`);
    const { rows } = await this.#pool.query(
      `SELECT ${col.sql} AS key,
              count(*)::int AS calls,
              count(*) FILTER (WHERE t.cost_priced)::int AS priced_calls,
              count(*) FILTER (WHERE NOT t.cost_priced)::int AS unpriced_calls,
              COALESCE(sum(t.cost_usd_micro) FILTER (WHERE t.cost_priced), 0)::text AS cost_usd_micro,
              COALESCE(sum(t.input_tokens), 0)::int AS input_tokens,
              COALESCE(sum(t.output_tokens), 0)::int AS output_tokens
         FROM model_traces t JOIN agent_runs r ON r.id = t.run_id
        WHERE ${col.sql} IS NOT NULL
          AND ($1::timestamptz IS NULL OR t.created_at >= $1) AND ($2::timestamptz IS NULL OR t.created_at < $2)
        GROUP BY 1 ORDER BY 1`,
      [since, until],
    );
    return rows.map((x) => ({ key: x.key, calls: x.calls, pricedCalls: x.priced_calls, unpricedCalls: x.unpriced_calls, costUsdMicro: x.cost_usd_micro, inputTokens: x.input_tokens, outputTokens: x.output_tokens }));
  }
}

/** Records one run. Ids are deterministic from an injected id factory. */
export class TraceRecorder {
  #store;
  #clock;
  #ids;
  #toolSeq = 0;
  #modelSeq = 0;
  constructor({ store, clock, idFactory }) {
    if (!store) throw new AgentError('CONFIG', 'trace store required');
    if (typeof clock !== 'function') throw new AgentError('CONFIG', 'clock required');
    if (typeof idFactory !== 'function') throw new AgentError('CONFIG', 'idFactory required');
    this.#store = store;
    this.#clock = clock;
    this.#ids = idFactory;
  }

  async startRun({ principalId, goal }) {
    const id = this.#ids('run');
    await this.#store.insertRun({ id, principalId, status: 'running', goal: redact(String(goal)), startedAt: this.#clock().toISOString() });
    return id;
  }

  async finishRun(runId, { status, stepCount, error, finalOutput }) {
    await this.#store.finishRun(runId, {
      status, stepCount, finishedAt: this.#clock().toISOString(),
      error: error == null ? null : redact(String(error)), finalOutput: finalOutput == null ? null : redact(String(finalOutput)),
    });
  }

  async toolCall(runId, result) {
    this.#toolSeq += 1;
    await this.#store.insertToolCall({
      id: this.#ids('tc'), runId, seq: this.#toolSeq, toolName: String(result.name).slice(0, 100),
      tier: result.status === 'rejected' ? 'REJECTED' : result.tier, status: result.status, rejectionCode: result.code ?? null,
      input: redact(result.input ?? null), output: redact(result.output ?? null), createdAt: this.#clock().toISOString(),
    });
  }

  async modelCall(runId, a) {
    this.#modelSeq += 1;
    await this.#store.insertModelTrace({
      id: this.#ids('mt'), runId, seq: this.#modelSeq, task: a.task, provider: a.provider, model: a.model, status: a.status,
      errorCode: a.error ? (a.error.code || 'ERROR') : null,
      request: redact(a.request ?? null), response: redact(a.result ? { content: a.result.content, toolCalls: a.result.toolCalls } : null),
      inputTokens: a.result?.usage?.inputTokens ?? null, outputTokens: a.result?.usage?.outputTokens ?? null,
      latencyMs: a.latencyMs ?? null, createdAt: this.#clock().toISOString(),
      // Phase 6 item 3 (migration 032): tier, cost and attribution — absent for Stage 12 callers
      tier: a.tier ?? null, taskType: a.taskType ?? null,
      cacheReadTokens: a.result?.usage?.cacheReadInputTokens ?? null, cacheWriteTokens: a.result?.usage?.cacheCreationInputTokens ?? null,
      costUsdMicro: a.cost?.costUsdMicro ?? null, costPriced: a.cost?.priced === true, priceVersion: a.cost?.priceVersion ?? null,
      strategyId: a.attribution?.strategyId ?? null, opportunityId: a.attribution?.opportunityId ?? null, machineRequestId: a.attribution?.machineRequestId ?? null,
    });
  }
}
