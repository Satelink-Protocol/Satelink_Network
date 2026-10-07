// Model price table + per-call cost (Phase 6 item 3). Versioned config: a price change is a NEW
// version, never an edit, so historical model_traces rows keep the version they were priced with.
//
// Prices are USD per million tokens. Because 1 token × ($ per 1M tokens) = micro-USD, the cost in
// micro-USD is an exact integer: tokens × price. Prompt-cache writes bill at 1.25× input, reads at
// 0.1× input (Anthropic); providers without cache pricing report 0 cache tokens.
// Source for Anthropic rows: Anthropic API pricing (first-party), cached 2026-06-24 in the
// claude-api reference. Groq rows are left UNPRICED until the founder confirms the contract rate —
// an unpriced call is recorded with cost_priced = false, never guessed.

export const PRICE_VERSION = 'model-prices/2026-10-07';

/** model → { inputPerMTok, outputPerMTok } in USD. */
export const PRICES = Object.freeze({
  'claude-opus-5': Object.freeze({ inputPerMTok: 5, outputPerMTok: 25 }),
  'claude-sonnet-5': Object.freeze({ inputPerMTok: 2, outputPerMTok: 10 }),
  'claude-haiku-4-5': Object.freeze({ inputPerMTok: 1, outputPerMTok: 5 }),
});

const nonNeg = (v) => (Number.isInteger(v) && v >= 0 ? BigInt(v) : 0n);

/**
 * @param {{ inputTokens?, outputTokens?, cacheCreationInputTokens?, cacheReadInputTokens? }} usage
 * @returns {{ priced: boolean, costUsdMicro: bigint|null, priceVersion: string|null }}
 */
export function costOf(model, usage = {}, prices = PRICES, version = PRICE_VERSION) {
  const p = prices[model];
  if (!p) return { priced: false, costUsdMicro: null, priceVersion: null };
  // integer arithmetic in units of 1/100 micro-USD so the 1.25× and 0.1× multipliers stay exact
  const inP = BigInt(Math.round(p.inputPerMTok * 100));
  const outP = BigInt(Math.round(p.outputPerMTok * 100));
  const centi = nonNeg(usage.inputTokens) * inP
    + nonNeg(usage.cacheCreationInputTokens) * inP * 125n / 100n
    + nonNeg(usage.cacheReadInputTokens) * inP * 10n / 100n
    + nonNeg(usage.outputTokens) * outP;
  return { priced: true, costUsdMicro: (centi + 99n) / 100n, priceVersion: version }; // round up: never under-report
}
