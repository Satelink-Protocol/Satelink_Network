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
}

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
                                 input_tokens, output_tokens, latency_ms, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [r.id, r.runId, r.seq, r.task, r.provider, r.model, r.status, r.errorCode, JSON.stringify(r.request), JSON.stringify(r.response),
        r.inputTokens, r.outputTokens, r.latencyMs, r.createdAt],
    );
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
    });
  }
}
