// apps/api/src/economics/pricing_intelligence/price_floor.js
//
// Profitability guard — the hard lower bound no autonomous recommendation may
// cross, plus the honest cost-recovery picture at current volume.
//
// Economic model (CLAUDE.md): revenue splits 50% node operators / 30%
// platform / 20% distribution pool. The platform's 30% share must cover the
// marginal cost of serving a call, so the enforceable floor is
//   max(PRICE_FLOOR_USD, marginal_cost_per_call / platform_share)
// Fixed infrastructure cost is reported (cost_recovery_price_usd,
// break_even_monthly_calls) but NOT folded into the floor: at low volume a
// fixed-cost-recovering price would exceed the whole market and kill demand —
// fixed costs are a volume problem, not a unit-price problem.
//
// The x402 rail has a separate hard floor: the CDP facilitator rejects
// verify below $0.001/call (empirically confirmed 2026-07-09).

export const REVENUE_SPLIT = { node_operators: 0.5, platform: 0.3, distribution_pool: 0.2 };
export const X402_FACILITATOR_FLOOR_USD = 0.001;

const env = (key, dflt) => {
  const v = parseFloat(process.env[key]);
  return Number.isFinite(v) && v >= 0 ? v : dflt;
};

/**
 * @param {object} opts
 * @param {number} opts.monthlyCallVolume — measured calls/month (from live traffic); used
 *   only for the reported break-even, never for the enforced floor.
 * @param {number} opts.currentPricePerCall — what the serving path bills today.
 */
export function computePriceFloor({ monthlyCallVolume = 0, currentPricePerCall }) {
  // Marginal cost of one extra call. Default 0: upstream RPC is a self-run
  // node (registered_nodes ap-south-1) with no per-call upstream fee.
  const marginalCost = env('MARGINAL_COST_PER_CALL_USD', 0);
  // Absolute floor — protects against a zero marginal cost collapsing the
  // guard to zero ("never race to zero").
  const absoluteFloor = env('PRICE_FLOOR_USD', 0.00001);
  const infraMonthly = env('INFRA_MONTHLY_COST_USD', 25); // Railway API+DB+Redis order of magnitude

  const marginalFloor = marginalCost / REVENUE_SPLIT.platform;
  const floor = Math.max(absoluteFloor, marginalFloor);

  const fixedPerCall = monthlyCallVolume > 0 ? infraMonthly / monthlyCallVolume : null;
  const costRecoveryPrice = fixedPerCall != null
    ? (fixedPerCall + marginalCost) / REVENUE_SPLIT.platform
    : null;
  const breakEvenMonthlyCalls = currentPricePerCall > 0
    ? Math.ceil(infraMonthly / (currentPricePerCall * REVENUE_SPLIT.platform))
    : null;

  return {
    floor_price_usd: floor,
    x402_floor_price_usd: X402_FACILITATOR_FLOOR_USD,
    inputs: {
      marginal_cost_per_call_usd: marginalCost,
      absolute_floor_usd: absoluteFloor,
      infra_monthly_cost_usd: infraMonthly,
      platform_revenue_share: REVENUE_SPLIT.platform,
      monthly_call_volume_measured: monthlyCallVolume,
    },
    // Reported, not enforced:
    cost_recovery_price_usd: costRecoveryPrice,
    break_even_monthly_calls_at_current_price: breakEvenMonthlyCalls,
    explanation:
      `floor = max(absolute_floor $${absoluteFloor}, marginal_cost $${marginalCost} / platform_share ` +
      `${REVENUE_SPLIT.platform}). Fixed infra ($${infraMonthly}/mo) is reported via cost_recovery_price ` +
      'and break_even volume but not folded into the unit floor.',
  };
}

/** Clamp a candidate price to the floor. Returns { price, clamped }. */
export function enforceFloor(candidate, floor) {
  if (!Number.isFinite(candidate) || candidate < floor) {
    return { price: floor, clamped: true };
  }
  return { price: candidate, clamped: false };
}
