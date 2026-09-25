// Regenerates docs/pricing-economics.md from the PlanCatalog (single source).
//   node scripts/pricing/economics_report.mjs > ../../docs/pricing-economics.md
import { loadCatalog } from '../../src/pricing_v2/catalog.mjs';
import { catalogEconomics } from '../../src/pricing_v2/economics.mjs';

const c = loadCatalog();
const f = c.economics.dodo_fees;
const $ = (x) => (x === null || x === undefined ? '—' : `${x < 0 ? '−' : ''}$${Math.abs(x).toFixed(2)}`);
const lines = [];
lines.push('# Pricing V2 — worst-case economics per plan');
lines.push('');
lines.push(`_Generated from \`apps/api/config/plan_catalog.v2.json\` version **${c.version}** by \`apps/api/scripts/pricing/economics_report.mjs\`. Do not edit by hand — change the catalog and regenerate._`);
lines.push('');
lines.push('## Rule');
lines.push('A plan or pack is **purchasable only if its worst-case contribution per charge is ≥ $0** (`publicCatalog().purchasable`; checkout refuses otherwise). Worst case = the most expensive Dodo fee path (base + international + subscription surcharge + fixed fee) **and** the full allowance of the longest month consumed at the configured marginal cost per UU.');
lines.push('');
lines.push('## Inputs');
lines.push(`- Dodo fees: base ${f.base_pct}% + $${f.base_fixed_usd.toFixed(2)} · international +${f.international_pct}% · subscriptions +${f.subscription_pct}% · India domestic cards/UPI ${f.india_domestic_pct}% + $${f.india_domestic_fixed_usd.toFixed(2)} · refund $${f.refund_fixed_usd.toFixed(2)} · dispute $${f.dispute_fixed_usd.toFixed(2)} (source: \`docs/web/PRICING_MODEL.md\`, \`docs/pricing-v2/02_USAGE_UNIT_MODEL.md\`).`);
lines.push(`- 1 UU = $${c.unit.usd_list_value} list; a Trading Intelligence request = ${c.meters.intelligence_request.uu} UU.`);
lines.push(`- Marginal cost per UU: **$${c.economics.marginal_cost_usd_per_uu}** — ${c.economics.marginal_cost_source}`);
lines.push(`- Longest month = ${c.economics.weeks_per_month_worst} weeks of the weekly allowance.`);
lines.push('');
lines.push('## Per charge');
lines.push('| Item | Charge | Price | Worst fee | India UPI fee | UU / cycle | UU cost | **Worst contribution** | Break-even cost / UU | Refund loss | Dispute loss (lost) | Gate |');
lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const e of catalogEconomics(c)) {
  for (const r of e.rows) {
    lines.push(`| ${e.id} | ${r.label} | ${$(r.priceUsd)} | ${$(r.feeWorstUsd)} | ${$(r.feeIndiaUpiUsd)} | ${r.uuPerCycle.toLocaleString('en-US')} | ${$(r.uuCostUsd)} | **${$(r.worstContributionUsd)}** | ${r.breakEvenCostPerUu === null ? '—' : '$' + r.breakEvenCostPerUu.toFixed(6)} | ${$(r.refundLossUsd)} | ${$(r.disputeLossUsd)} | ${e.gate} |`);
  }
}
lines.push('');
lines.push('## Reading it');
lines.push('- **Every paid plan and pack passes** at the configured marginal cost. The binding risk is not steady state but **loss events**: a lost dispute costs the price **plus $30**, which on the $5 Launch intro erases ~8 intro payments (see `docs/pricing-v2/02_USAGE_UNIT_MODEL.md` §59). Mitigations there (UPI-first, velocity limits on $5 checkouts, email verification before the charge) are founder decisions.');
lines.push('- **Break-even cost / UU** is the marginal cost at which the worst case hits $0. If Trading Intelligence ever gains a real per-call cost above it, the gate flips that item to non-purchasable automatically.');
lines.push('- INR prices are `null` in the catalog until the founder sets round rupee amounts (Dodo localized pricing). No PPP discounts at launch.');
lines.push('- **Live mode stays off** — a founder decision after Dodo business verification.');
console.log(lines.join('\n'));
