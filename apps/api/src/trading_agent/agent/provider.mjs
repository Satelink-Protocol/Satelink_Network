// AIProvider interface (Stage 12).
//
//   chat(messages, opts)                    → { content, toolCalls[], usage, model, provider }
//   reason(messages, opts)                  → same shape; providers may use a reasoning model/setting
//   structuredOutput(messages, schema, opts)→ parsed object, ALWAYS re-validated against `schema`
//   stream(messages, opts)                  → async iterable of { delta } chunks
//
// Providers only transform text. They never receive tool handlers, ports,
// credentials of any broker, or the ability to execute anything. Provider API
// keys are injected by the composition root; agent code never reads env.
import { AgentError, ProviderError } from './errors.mjs';
import { assertSchema, assertValid } from './schema.mjs';

export const Task = Object.freeze({ CHAT: 'chat', REASON: 'reason', STRUCTURED: 'structured', STREAM: 'stream' });

export class AIProvider {
  /** @returns {string} provider id, e.g. 'groq' */
  get id() { throw new Error(`${this.constructor.name}.id not implemented`); }

  async chat(_messages, _opts) { throw new Error(`${this.constructor.name}.chat() not implemented`); }

  /** Default: a chat call flagged as reasoning; adapters may override (e.g. a reasoning model). */
  async reason(messages, opts = {}) { return this.chat(messages, { ...opts, reasoning: true }); }

  /**
   * Structured output with mandatory re-validation. Even if an adapter uses a
   * provider's native JSON mode, the result is parsed and validated here.
   */
  async structuredOutput(messages, schema, opts = {}) {
    assertSchema(schema, 'structuredOutput');
    const instruction = { role: 'system', content: `Respond with a single JSON value matching this JSON schema, and nothing else:\n${JSON.stringify(schema)}` };
    const res = await this.chat([instruction, ...messages], { ...opts, jsonMode: true, tools: undefined });
    opts.onUsage?.(res); // cost metering (tiered_router.mjs); the value itself is still re-validated below
    let parsed;
    try { parsed = JSON.parse(stripFences(res.content ?? '')); }
    catch { throw new AgentError('SCHEMA_INVALID', 'model output is not valid JSON'); }
    return assertValid(schema, parsed, 'structured output');
  }

  /** Default stream: a single chunk from chat(). Adapters with real streaming override. */
  async *stream(messages, opts = {}) {
    const res = await this.chat(messages, { ...opts, tools: undefined });
    yield { delta: res.content ?? '' };
  }
}

function stripFences(s) {
  const m = s.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1] : s.trim();
}

/** Deterministic scripted provider for tests: returns queued responses in order. */
export class ScriptedProvider extends AIProvider {
  #id;
  #script;
  calls = [];
  constructor({ id = 'scripted', script = [] } = {}) {
    super();
    this.#id = id;
    this.#script = [...script];
  }
  get id() { return this.#id; }
  async chat(messages, opts = {}) {
    this.calls.push({ messages, opts });
    if (this.#script.length === 0) throw new ProviderError('script exhausted', { provider: this.#id });
    const next = this.#script.shift();
    if (next instanceof Error) throw next;
    const r = typeof next === 'function' ? next(messages, opts) : next;
    return { content: r.content ?? '', toolCalls: r.toolCalls ?? [], usage: r.usage ?? { inputTokens: 0, outputTokens: 0 }, model: r.model ?? 'scripted-1', provider: this.#id };
  }
}
