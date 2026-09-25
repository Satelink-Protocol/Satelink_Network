// Worst-case contribution per plan/pack per billing cycle, with real Dodo fees
// (catalog.economics). A plan whose worst case is negative is NOT purchasable
// (publicCatalog.purchasable=false, checkout refuses it). Pure functions.
//
// Worst case for one cycle = the customer pays through the most expensive fee
// path (international card + subscription surcharge + fixed fee) AND consumes
// the entire allowance of the longest month (weekly_uu × weeks_per_month_worst)
// at the configured marginal cost per UU. Refund / dispute outcomes are loss
// EVENTS, reported separately (they do not depend on the plan design beyond
// price), not folded into the steady-state gate.

const r2 = (x) => Math.round(x * 100) / 100;

export function feeWorst(priceUsd, { subscription }, fees) {
  if (priceUsd <= 0) return 0;
  const pct = fees.base_pct + fees.international_pct + (subscription ? fees.subscription_pct : 0);
  return priceUsd * (pct / 100) + fees.base_fixed_usd;
}

export function feeIndiaDomestic(priceUsd, { subscription }, fees) {
  if (priceUsd <= 0) return 0;
  const pct = fees.india_domestic_pct + (subscription ? fees.subscription_pct : 0);
  return priceUsd * (pct / 100) + fees.india_domestic_fixed_usd;
}

function cycleUu(item, c) {
  if (item.grant_uu) return item.grant_uu;
  const ent = item.entitlement_plan ? c.plans.find((p) => p.id === item.entitlement_plan) : item;
  // A yearly plan's cycle is the year: its allowance over the longest year.
  return ent.allowance.weekly_uu * (item.interval === 'year' ? (c.economics.weeks_per_year_worst ?? 53) : c.economics.weeks_per_month_worst);
}

/** One row per charge the item can produce (Launch: intro cycle + renewal). */
export function worstCase(item, c) {
  const e = c.economics;
  const fees = e.dodo_fees;
  const subscription = item.kind === 'subscription';
  const uu = item.kind === 'free' ? cycleUu(item, c) : cycleUu(item, c);
  const uuCost = uu * e.marginal_cost_usd_per_uu;
  const charges = item.intro ? [{ label: 'intro cycle', price: item.intro.amount_usd }, { label: 'renewal', price: item.price_usd }] : [{ label: subscription ? (item.interval === 'year' ? 'yearly' : 'monthly') : item.kind === 'free' ? 'free' : 'one-time', price: item.price_usd }];
  const rows = charges.map(({ label, price }) => {
    const fw = feeWorst(price, { subscription }, fees);
    const contribution = price - fw - uuCost;
    return {
      label,
      priceUsd: price,
      feeWorstUsd: r2(fw),
      feeIndiaUpiUsd: r2(feeIndiaDomestic(price, { subscription }, fees)),
      uuPerCycle: Math.round(uu),
      uuCostUsd: r2(uuCost),
      worstContributionUsd: r2(contribution),
      breakEvenCostPerUu: uu > 0 ? (price - fw) / uu : null,
      refundLossUsd: price > 0 ? r2(-(price) - fees.refund_fixed_usd + 0) : 0,
      disputeLossUsd: price > 0 ? r2(-(price) - fees.dispute_fixed_usd) : 0,
    };
  });
  // Free has no revenue: its "contribution" is the cost of its allowance, and it
  // is gated on cost only (a positive marginal cost makes it a CAC line item).
  const gate = item.kind === 'free' ? 'pass' : rows.every((r) => r.worstContributionUsd >= 0) ? 'pass' : 'fail';
  return { id: item.id, rows, gate };
}

export function catalogEconomics(c) {
  return [...c.plans, ...c.packs].map((i) => worstCase(i, c));
}
