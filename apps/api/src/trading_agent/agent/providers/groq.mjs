// Groq adapter (Stage 12): the provider the codebase already uses
// (apps/api/src/workloads/ai_gateway/index.js calls the same OpenAI-compatible
// endpoint). ADAPT per audit/05: a NEW adapter behind AIProvider. The existing
// AI gateway is not imported or changed (its behaviour, billing rows and
// model mapping stay exactly as they are).
//
// The API key and fetch are INJECTED by the composition root; this module never
// reads process.env and never logs or returns the key.
import { AIProvider } from '../provider.mjs';
import { ProviderError } from '../errors.mjs';

export const GROQ_DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';

export class GroqProvider extends AIProvider {
  #apiKey;
  #fetch;
  #baseUrl;
  #timeoutMs;

  constructor({ apiKey, fetch, baseUrl = GROQ_DEFAULT_BASE_URL, timeoutMs = 30_000 }) {
    super();
    if (typeof apiKey !== 'string' || apiKey.length < 8) throw new ProviderError('GroqProvider requires an injected apiKey', { provider: 'groq' });
    if (typeof fetch !== 'function') throw new ProviderError('GroqProvider requires an injected fetch', { provider: 'groq' });
    this.#apiKey = apiKey;
    this.#fetch = fetch;
    this.#baseUrl = baseUrl.replace(/\/+$/, '');
    this.#timeoutMs = timeoutMs;
  }

  get id() { return 'groq'; }

  #body(messages, { model, tools, jsonMode, maxTokens = 1024, temperature = 0, stream = false }) {
    if (typeof model !== 'string' || !model) throw new ProviderError('model required', { provider: 'groq' });
    const body = { model, messages, max_tokens: maxTokens, temperature, stream };
    if (tools && tools.length) { body.tools = tools; body.tool_choice = 'auto'; }
    if (jsonMode) body.response_format = { type: 'json_object' };
    return body;
  }

  async #post(body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.#timeoutMs);
    let res;
    try {
      res = await this.#fetch(`${this.#baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.#apiKey}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new ProviderError(`groq request failed: ${e.name === 'AbortError' ? 'timeout' : 'network'}`, { retryable: true, provider: 'groq' });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      throw new ProviderError(`groq HTTP ${res.status}`, { retryable, status: res.status, provider: 'groq' });
    }
    return res;
  }

  async chat(messages, opts = {}) {
    const res = await this.#post(this.#body(messages, opts));
    const data = await res.json();
    const choice = data?.choices?.[0]?.message ?? {};
    return {
      content: choice.content ?? '',
      toolCalls: (choice.tool_calls ?? []).map((tc) => ({ id: tc.id, name: tc.function?.name, arguments: tc.function?.arguments ?? '{}' })),
      usage: { inputTokens: data?.usage?.prompt_tokens ?? 0, outputTokens: data?.usage?.completion_tokens ?? 0 },
      model: data?.model ?? opts.model,
      provider: 'groq',
    };
  }

  /** Server-sent events stream (OpenAI-compatible `data: {...}` lines). */
  async *stream(messages, opts = {}) {
    const res = await this.#post(this.#body(messages, { ...opts, tools: undefined, stream: true }));
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return;
        const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
        if (delta) yield { delta };
      }
    }
  }
}
