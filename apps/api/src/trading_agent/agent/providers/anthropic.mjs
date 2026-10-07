// Anthropic adapter (Phase 6 item 3): Claude behind the Stage 12 AIProvider interface, using the
// official SDK (@anthropic-ai/sdk, MIT).
//
// - The API key is INJECTED by the caller (composition root / secret loader). This module never
//   reads environment variables, never logs or returns the key; the SDK is constructed with the explicit key.
// - The runtime speaks OpenAI-style messages (assistant `tool_calls`, role `tool`). They are
//   translated to Messages API turns here. An assistant turn the model produced is replayed with its
//   ORIGINAL content blocks (thinking included), cached by tool_use id — Claude needs them unchanged.
// - Errors map through the SDK's typed classes: 429 / 5xx / connection / timeout are retryable (the
//   router may fall back); 400 / 401 / 403 / 404 are not. A `refusal` stop is a non-retryable
//   ProviderError (code REFUSED) — never treated as an empty answer.
// - claude-opus-5 requests opt into server-side refusal fallbacks (`fallbacks: "default"`).
// - structuredOutput uses native JSON-schema output, and the result is STILL re-validated with
//   Satelink's own schema (schema.mjs).
import { AIProvider } from '../provider.mjs';
import { ProviderError, AgentError } from '../errors.mjs';
import { assertSchema, assertValid } from '../schema.mjs';

const SERVER_FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const FALLBACK_MODELS = new Set(['claude-opus-5']);
const REPLAY_CACHE_MAX = 256;

export class AnthropicProvider extends AIProvider {
  #client; #sdk; #replay = new Map();

  /**
   * @param {{ apiKey: string, Anthropic: Function, maxRetries?: number, timeoutMs?: number, fetch?: typeof fetch }} opts
   *   `Anthropic` is the SDK's default export, injected by the composition root (trading_agent/ai_providers.mjs);
   *   tests inject a fake with the same typed error classes.
   */
  constructor({ apiKey, Anthropic, maxRetries = 1, timeoutMs = 60_000, fetch }) {
    super();
    if (typeof apiKey !== 'string' || apiKey.length < 8) throw new ProviderError('AnthropicProvider requires an injected apiKey', { provider: 'anthropic' });
    if (typeof Anthropic !== 'function') throw new ProviderError('AnthropicProvider requires the SDK class', { provider: 'anthropic' });
    this.#sdk = Anthropic;
    this.#client = new Anthropic({ apiKey, maxRetries, timeout: timeoutMs, ...(fetch ? { fetch } : {}) });
  }

  get id() { return 'anthropic'; }

  /** OpenAI-style runtime messages → { system, messages } for the Messages API. */
  toMessagesApi(messages) {
    const system = [];
    const out = [];
    const push = (role, blocks) => {
      const last = out.at(-1);
      if (last && last.role === role) last.content.push(...blocks);
      else out.push({ role, content: [...blocks] });
    };
    for (const m of messages) {
      if (m.role === 'system') { system.push(String(m.content ?? '')); continue; }
      if (m.role === 'tool') { push('user', [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: String(m.content ?? '') }]); continue; }
      if (m.role === 'assistant') {
        const ids = (m.tool_calls ?? []).map((c) => c.id);
        const cached = ids.length ? this.#replay.get(ids[0]) : null;
        if (cached) { push('assistant', cached); continue; }
        const blocks = [];
        if (m.content) blocks.push({ type: 'text', text: String(m.content) });
        for (const c of m.tool_calls ?? []) {
          let input;
          try { input = typeof c.function?.arguments === 'string' ? JSON.parse(c.function.arguments) : (c.function?.arguments ?? {}); } catch { input = {}; }
          blocks.push({ type: 'tool_use', id: c.id, name: c.function?.name, input });
        }
        if (blocks.length) push('assistant', blocks);
        continue;
      }
      push('user', [{ type: 'text', text: String(m.content ?? '') }]);
    }
    return { system: system.join('\n\n') || undefined, messages: out };
  }

  #params(messages, { model, tools, maxTokens = 16_000, effort }) {
    if (typeof model !== 'string' || !model) throw new ProviderError('model required', { provider: 'anthropic' });
    const { system, messages: msgs } = this.toMessagesApi(messages);
    const params = { model, max_tokens: maxTokens, messages: msgs };
    if (system) params.system = system;
    if (effort) params.output_config = { effort };
    if (tools && tools.length) {
      params.tools = tools.map((t) => ({ name: t.function?.name ?? t.name, description: t.function?.description ?? t.description ?? '', input_schema: t.function?.parameters ?? t.input_schema ?? { type: 'object', properties: {} } }));
    }
    return params;
  }

  async #create(params) {
    try {
      if (FALLBACK_MODELS.has(params.model)) {
        return await this.#client.beta.messages.create({ ...params, betas: [SERVER_FALLBACK_BETA], fallbacks: 'default' });
      }
      return await this.#client.messages.create(params);
    } catch (e) {
      throw this.#mapError(e);
    }
  }

  #mapError(e) {
    const A = this.#sdk;
    const mk = (msg, retryable, status) => new ProviderError(`anthropic ${msg}`, { retryable, status, provider: 'anthropic' });
    if (A.RateLimitError && e instanceof A.RateLimitError) return mk('rate limited', true, 429);
    if (A.InternalServerError && e instanceof A.InternalServerError) return mk(`server error ${e.status}`, true, e.status ?? 500);
    if (A.APIConnectionTimeoutError && e instanceof A.APIConnectionTimeoutError) return mk('timeout', true, null);
    if (A.APIConnectionError && e instanceof A.APIConnectionError) return mk('connection error', true, null);
    if (A.AuthenticationError && e instanceof A.AuthenticationError) return mk('authentication failed', false, 401);
    if (A.PermissionDeniedError && e instanceof A.PermissionDeniedError) return mk('permission denied', false, 403);
    if (A.NotFoundError && e instanceof A.NotFoundError) return mk('not found', false, 404);
    if (A.BadRequestError && e instanceof A.BadRequestError) return mk('bad request', false, 400);
    if (A.APIError && e instanceof A.APIError) return mk(`HTTP ${e.status}`, e.status === 529 || (e.status ?? 0) >= 500, e.status ?? null);
    return mk('request failed', false, null);
  }

  #remember(content) {
    const ids = content.filter((b) => b.type === 'tool_use').map((b) => b.id);
    if (!ids.length) return;
    this.#replay.set(ids[0], content);
    while (this.#replay.size > REPLAY_CACHE_MAX) this.#replay.delete(this.#replay.keys().next().value);
  }

  #result(res, requestedModel) {
    if (res.stop_reason === 'refusal') {
      const e = new ProviderError(`anthropic refusal${res.stop_details?.category ? ` (${res.stop_details.category})` : ''}`, { retryable: false, provider: 'anthropic' });
      e.code = 'REFUSED';
      throw e;
    }
    const content = res.content ?? [];
    this.#remember(content);
    const u = res.usage ?? {};
    return {
      content: content.filter((b) => b.type === 'text').map((b) => b.text).join(''),
      toolCalls: content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, arguments: JSON.stringify(b.input ?? {}) })),
      usage: {
        inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0,
        cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0, cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
      },
      model: res.model ?? requestedModel,
      provider: 'anthropic',
      stopReason: res.stop_reason ?? null,
    };
  }

  async chat(messages, opts = {}) {
    const res = await this.#create(this.#params(messages, opts));
    return this.#result(res, opts.model);
  }

  /** Native JSON-schema output; the parsed value is re-validated with Satelink's schema regardless. */
  async structuredOutput(messages, schema, opts = {}) {
    assertSchema(schema, 'structuredOutput');
    const params = this.#params(messages, { ...opts, tools: undefined });
    params.output_config = { ...(params.output_config ?? {}), format: { type: 'json_schema', schema } };
    const res = this.#result(await this.#create(params), opts.model);
    opts.onUsage?.(res);
    let parsed;
    try { parsed = JSON.parse(res.content); } catch { throw new AgentError('SCHEMA_INVALID', 'model output is not valid JSON'); }
    return assertValid(schema, parsed, 'structured output');
  }

  async *stream(messages, opts = {}) {
    const params = this.#params(messages, { ...opts, tools: undefined });
    let s;
    try { s = this.#client.messages.stream(params); } catch (e) { throw this.#mapError(e); }
    try {
      for await (const ev of s) {
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') yield { delta: ev.delta.text };
      }
    } catch (e) {
      throw this.#mapError(e);
    }
  }
}
