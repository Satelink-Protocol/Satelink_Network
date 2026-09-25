// Sync the PlanCatalog with Dodo products — TEST MODE ONLY unless --live is
// passed (and live stays a founder decision). Reconciles either way:
//   1. list Dodo products, match on metadata.satelink_product_id,
//   2. (--apply) create the missing ones with the catalog's price shape
//      (Launch = $19/month recurring with a paid first cycle: trial_amount 500,
//      trial_period_days 30), stamp satelink_product_id + satelink_plan_version,
//   3. write the matched ids back into config/plan_catalog.v2.json (dodo.<mode>).
// Never prints the API key. Dry-run by default.
//   railway run --service Satelink-api -- node scripts/dodo/sync_catalog_products.mjs [--apply]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const live = process.argv.includes('--live');
const apply = process.argv.includes('--apply');
if (live) throw new Error('Live mode is a founder decision after Dodo business verification — not run by this script.');
const mode = 'test';
const BASE = 'https://test.dodopayments.com';
const KEY = process.env.DODO_API_KEY_TEST || process.env.DODO_TESTMODE_API_KEY;
if (!KEY) throw new Error('No Dodo test-mode key in env (DODO_API_KEY_TEST / DODO_TESTMODE_API_KEY)');

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'config', 'plan_catalog.v2.json');
const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));

async function dodo(method, p, body) {
  const r = await fetch(BASE + p, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let j = null;
  try { j = JSON.parse(text); } catch { /* keep text */ }
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${text.slice(0, 300)}`);
  return j;
}

function desiredBody(item, kind) {
  const metadata = { satelink_product_id: item.id, satelink_plan_version: catalog.version };
  if (kind === 'pack') {
    return {
      name: `Satelink — ${item.name}`,
      description: `${item.grant_uu.toLocaleString('en-US')} Usage Units for Trading Intelligence. Prepaid; does not expire.`,
      tax_category: 'saas',
      price: { type: 'one_time_price', price: Math.round(item.price_usd * 100), currency: 'USD', discount: 0, purchasing_power_parity: false },
      metadata,
    };
  }
  const price = {
    type: 'recurring_price', price: Math.round(item.price_usd * 100), currency: 'USD', discount: 0, purchasing_power_parity: false,
    payment_frequency_count: 1, payment_frequency_interval: item.interval === 'year' ? 'Year' : 'Month', subscription_period_count: 10, subscription_period_interval: 'Year',
  };
  if (item.intro) Object.assign(price, { trial_period_days: item.intro.trial_period_days, trial_amount: Math.round(item.intro.amount_usd * 100), trial_apply_discounts: false });
  return {
    name: `Satelink ${item.name}${item.interval === 'year' ? ' (yearly)' : ''}`,
    description: item.intro ? item.intro.copy : `Satelink ${item.name} — $${item.price_usd}/${item.interval === 'year' ? 'year' : 'month'}.`,
    tax_category: 'saas',
    price,
    metadata,
  };
}

const list = await dodo('GET', '/products?page_size=100');
const products = list.items || [];
const byMeta = new Map(products.filter((p) => p.metadata?.satelink_product_id).map((p) => [p.metadata.satelink_product_id, p]));
const report = [];

for (const [kind, items] of [['plan', catalog.plans.filter((p) => p.kind === 'subscription')], ['pack', catalog.packs]]) {
  for (const item of items) {
    let p = byMeta.get(item.id);
    if (p) {
      const needsStamp = p.metadata?.satelink_plan_version !== catalog.version;
      if (needsStamp && apply) {
        await dodo('PATCH', `/products/${p.product_id}`, { metadata: { ...p.metadata, satelink_product_id: item.id, satelink_plan_version: catalog.version } });
      }
      report.push({ id: item.id, product_id: p.product_id, action: needsStamp ? (apply ? 'stamped' : 'would-stamp') : 'matched', price: p.price });
    } else if (apply) {
      p = await dodo('POST', '/products', desiredBody(item, kind));
      report.push({ id: item.id, product_id: p.product_id, action: 'created', price: p.price });
    } else {
      report.push({ id: item.id, product_id: null, action: 'would-create' });
    }
    if (p) item.dodo = { ...(item.dodo || {}), [mode]: p.product_id };
  }
}

// Read back what was created/matched to verify price shape (esp. Launch trial).
if (apply) {
  for (const r of report.filter((x) => x.product_id)) {
    const p = await dodo('GET', `/products/${r.product_id}`);
    r.verified = { price: p.price?.price, currency: p.price?.currency, recurring: p.is_recurring, trial_days: p.price?.trial_period_days ?? null, trial_amount: p.price?.trial_amount ?? null, meta: p.metadata };
  }
  fs.writeFileSync(file, JSON.stringify(catalog, null, 2) + '\n');
}
for (const r of report) console.log(JSON.stringify({ id: r.id, product_id: r.product_id, action: r.action, verified: r.verified }));
