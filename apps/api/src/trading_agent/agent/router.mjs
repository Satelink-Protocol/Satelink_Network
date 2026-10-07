// Model router (Stage 12): deterministic route table + fallback on retryable errors.
import { AgentError, ProviderError } from './errors.mjs';
import { Task } from './provider.mjs';

/**
 * routes: { [task]: [{ provider: 'groq', model: 'llama-3.3-70b-versatile' }, …fallbacks] }
 * providers: { [id]: AIProvider }
 */
export class ModelRouter {
  #routes;
  #providers;
  /** @param keys allowed route keys — the Stage 12 tasks by default, or the LLM tiers (tiered_router.mjs) */
  constructor({ routes, providers, keys = Object.values(Task) }) {
    for (const [task, chain] of Object.entries(routes || {})) {
      if (!keys.includes(task)) throw new AgentError('CONFIG', `unknown task ${task}`);
      if (!Array.isArray(chain) || chain.length === 0) throw new AgentError('CONFIG', `route for ${task} must be a non-empty array`);
      for (const r of chain) {
        if (!providers?.[r.provider]) throw new AgentError('CONFIG', `route ${task}: unknown provider ${r.provider}`);
        if (typeof r.model !== 'string' || !r.model) throw new AgentError('CONFIG', `route ${task}: model required`);
      }
    }
    this.#routes = Object.freeze(structuredClone(routes));
    this.#providers = providers;
  }

  routeFor(task) {
    const chain = this.#routes[task];
    if (!chain) throw new AgentError('ROUTE_NOT_FOUND', `no route for task ${task}`);
    return chain;
  }

  /**
   * Run `fn(provider, model)` along the route chain. Falls back ONLY on retryable
   * ProviderErrors. Every attempt is reported to `onAttempt` for tracing.
   */
  async run(task, fn, { onAttempt } = {}) {
    const chain = this.routeFor(task);
    let lastErr;
    for (let i = 0; i < chain.length; i += 1) {
      const { provider: pid, model } = chain[i];
      const started = Date.now();
      try {
        const result = await fn(this.#providers[pid], model);
        await onAttempt?.({ task, provider: pid, model, status: i === 0 ? 'ok' : 'fallback', latencyMs: Date.now() - started, result });
        return result;
      } catch (e) {
        await onAttempt?.({ task, provider: pid, model, status: 'error', latencyMs: Date.now() - started, error: e });
        lastErr = e;
        if (!(e instanceof ProviderError) || !e.retryable) throw e;
      }
    }
    throw lastErr;
  }
}
