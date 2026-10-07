// Tiered model router (Phase 6 item 3). Routes by TASK TYPE → tier → provider chain, reusing the
// Stage 12 ModelRouter for the chain itself (fallback ONLY on retryable ProviderErrors).
//
//   deterministic tasks → refused (AgentError DETERMINISTIC_ONLY): the LLM never answers prices,
//                         balances, P&L, risk results or order state.
//   every attempt       → recorded with tier, task type, tokens, cost (micro-USD) and attribution
//                         (strategy / opportunity / machine request; the user comes from the run).
//   structured outputs  → re-validated with Satelink's own schema here too (defence in depth).
import { ModelRouter } from './router.mjs';
import { AgentError } from './errors.mjs';
import { assertSchema, assertValid } from './schema.mjs';
import { Tier, LLM_TIERS, DEFAULT_TIER_ROUTES, TIER_OPTIONS, tierFor, ROUTER_CONFIG_VERSION } from './tiers.mjs';
import { costOf } from './pricing.mjs';

const ATTRIBUTION_KEYS = ['strategyId', 'opportunityId', 'machineRequestId'];

export class TieredModelRouter {
  #router; #prices;
  constructor({ providers, routes = DEFAULT_TIER_ROUTES, prices } = {}) {
    for (const k of Object.keys(routes)) if (!LLM_TIERS.includes(k)) throw new AgentError('CONFIG', `route key ${k} is not an LLM tier`);
    this.#router = new ModelRouter({ routes, providers, keys: LLM_TIERS });
    this.#prices = prices;
    this.configVersion = ROUTER_CONFIG_VERSION;
  }

  /** Pure plan: which tier and chain a task type would use. Deterministic → chain null. */
  plan(taskType) {
    const tier = tierFor(taskType);
    return Object.freeze({ taskType, tier, chain: tier === Tier.DETERMINISTIC ? null : this.#router.routeFor(tier) });
  }

  /**
   * @param {{ taskType: string, messages: object[], schema?: object, runId?: string, recorder?: TraceRecorder,
   *           attribution?: { strategyId?, opportunityId?, machineRequestId? } }} req
   * @returns chat result, or the validated structured value when `schema` is given
   */
  async complete({ taskType, messages, schema, runId, recorder, attribution = {} }) {
    const tier = tierFor(taskType);
    if (tier === Tier.DETERMINISTIC) throw new AgentError('DETERMINISTIC_ONLY', `${taskType} is answered by deterministic engines, never by an LLM`);
    if (schema) assertSchema(schema, 'TieredModelRouter.complete');
    const attr = Object.fromEntries(ATTRIBUTION_KEYS.map((k) => [k, typeof attribution[k] === 'string' ? attribution[k] : null]));
    const base = TIER_OPTIONS[tier];
    const usageByAttempt = new Map();

    const result = await this.#router.run(tier, async (provider, model) => {
      const opts = { ...base, model, onUsage: (r) => usageByAttempt.set(model, r) };
      if (schema) return provider.structuredOutput(messages, schema, opts);
      const r = await provider.chat(messages, opts);
      usageByAttempt.set(model, r);
      return r;
    }, {
      onAttempt: async (a) => {
        if (!recorder || !runId) return;
        const r = usageByAttempt.get(a.model);
        const usage = r?.usage ?? {};
        const cost = a.status === 'error' && !r ? { priced: false, costUsdMicro: null, priceVersion: null } : costOf(r?.model ?? a.model, usage, this.#prices);
        await recorder.modelCall(runId, {
          ...a, task: schema ? 'structured' : 'chat', tier, taskType, attribution: attr, cost,
          result: r ? { content: r.content, toolCalls: r.toolCalls, usage } : (a.status === 'error' ? null : undefined),
          request: { taskType, tier, messages: messages.length },
        });
      },
    });
    return schema ? assertValid(schema, result, 'tiered structured output') : result;
  }
}
