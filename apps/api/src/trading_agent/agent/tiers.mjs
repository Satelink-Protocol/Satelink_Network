// Model router tiers (Phase 6 item 3). Routing is by TASK TYPE, never by who is asking.
//
//   deterministic — NEVER calls an LLM: prices, balances, P&L, risk results, order state. Those
//                   come from the deterministic engines / stores; an LLM answer there is refused.
//   fast          — short, cheap, high-volume language work (classify, extract, format)
//   standard      — explanations and drafting (risk explanation, strategy draft, portfolio notes)
//   deep          — hard reasoning (challenger review, post-trade review, research)
// Config is versioned ('model-router/1.0'); changing a mapping is a new version.

export const ROUTER_CONFIG_VERSION = 'model-router/1.0';

export const Tier = Object.freeze({ DETERMINISTIC: 'deterministic', FAST: 'fast', STANDARD: 'standard', DEEP: 'deep' });
export const LLM_TIERS = Object.freeze([Tier.FAST, Tier.STANDARD, Tier.DEEP]);

export const TASK_TIER = Object.freeze({
  // deterministic: answered by engines/stores only
  price_lookup: Tier.DETERMINISTIC, balance_lookup: Tier.DETERMINISTIC, pnl_lookup: Tier.DETERMINISTIC,
  risk_check: Tier.DETERMINISTIC, order_state: Tier.DETERMINISTIC, position_lookup: Tier.DETERMINISTIC,
  indicator_compute: Tier.DETERMINISTIC, scorecard_compute: Tier.DETERMINISTIC,
  // fast
  classify_intent: Tier.FAST, extract_parameters: Tier.FAST, format_receipt: Tier.FAST, summarize_news: Tier.FAST,
  // standard
  explain_risk: Tier.STANDARD, draft_strategy: Tier.STANDARD, portfolio_note: Tier.STANDARD, interpret_regime: Tier.STANDARD,
  market_brief: Tier.STANDARD,
  // deep
  challenger_review: Tier.DEEP, post_trade_review: Tier.DEEP, strategy_research: Tier.DEEP,
});

export function tierFor(taskType) {
  const t = TASK_TIER[taskType];
  if (!t) throw Object.assign(new Error(`unknown task type ${taskType}`), { code: 'UNKNOWN_TASK_TYPE' });
  return t;
}

/** Default tier routes (primary first, fallbacks after). Anthropic primary; Groq as fallback. */
export const DEFAULT_TIER_ROUTES = Object.freeze({
  [Tier.FAST]: [{ provider: 'anthropic', model: 'claude-haiku-4-5' }, { provider: 'groq', model: 'llama-3.1-8b-instant' }],
  [Tier.STANDARD]: [{ provider: 'anthropic', model: 'claude-sonnet-5' }, { provider: 'groq', model: 'llama-3.3-70b-versatile' }],
  [Tier.DEEP]: [{ provider: 'anthropic', model: 'claude-opus-5' }, { provider: 'anthropic', model: 'claude-sonnet-5' }],
});

/** Per-tier request defaults (effort applies to Anthropic models that accept it). */
export const TIER_OPTIONS = Object.freeze({
  [Tier.FAST]: Object.freeze({ maxTokens: 2_000 }),
  [Tier.STANDARD]: Object.freeze({ maxTokens: 8_000, effort: 'medium' }),
  [Tier.DEEP]: Object.freeze({ maxTokens: 16_000, effort: 'high' }),
});
