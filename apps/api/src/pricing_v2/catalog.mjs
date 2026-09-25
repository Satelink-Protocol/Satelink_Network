// PlanCatalog (Pricing V2) — versioned, loaded from config, never hard-coded
// in code or UI. Every consumer (API /v2/plans, console Billing, the public
// /pricing page, checkout, economics gate) reads this one object.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { worstCase } from './economics.mjs';

const DEFAULT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'config', 'plan_catalog.v2.json');

let cached = null;

export function validateCatalog(c) {
  const errs = [];
  if (!c || typeof c.version !== 'string') errs.push('version missing');
  if (!(c?.unit?.usd_list_value > 0)) errs.push('unit.usd_list_value must be > 0');
  const ids = new Set();
  for (const p of [...(c?.plans || []), ...(c?.packs || [])]) {
    if (!p.id || ids.has(p.id)) errs.push(`duplicate or missing id: ${p.id}`);
    ids.add(p.id);
    if (!(p.price_usd >= 0)) errs.push(`${p.id}: price_usd`);
  }
  for (const p of c?.plans || []) {
    if (!(p.allowance?.session_uu > 0) || !(p.allowance?.weekly_uu >= p.allowance.session_uu)) errs.push(`${p.id}: allowance session/weekly`);
    if (p.intro && !(p.intro.amount_usd > 0 && p.intro.trial_period_days > 0)) errs.push(`${p.id}: intro`);
    if (p.inr_price !== null && p.inr_price !== undefined && !Number.isInteger(p.inr_price)) errs.push(`${p.id}: inr_price must be whole rupees or null`);
  }
  for (const k of c?.packs || []) if (!(k.grant_uu > 0)) errs.push(`${k.id}: grant_uu`);
  return errs;
}

export function loadCatalog({ file = process.env.PLAN_CATALOG_PATH || DEFAULT_PATH, reload = false } = {}) {
  if (cached && !reload) return cached;
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  const errs = validateCatalog(c);
  if (errs.length) throw new Error(`PlanCatalog invalid: ${errs.join('; ')}`);
  cached = Object.freeze(c);
  return cached;
}

export function getPlan(id, c = loadCatalog()) {
  return c.plans.find((p) => p.id === id) || null;
}
export function getPack(id, c = loadCatalog()) {
  return c.packs.find((p) => p.id === id) || null;
}
/** The entitlement a plan grants (Launch grants Pro's). */
export function entitlementPlan(planId, c = loadCatalog()) {
  const p = getPlan(planId, c);
  return p?.entitlement_plan ? getPlan(p.entitlement_plan, c) : p;
}
/** Current Dodo product id for a plan/pack in a mode ('test' | 'live'), or null. */
export function dodoProductId(item, mode) {
  return item?.dodo?.[mode] || null;
}
/** Reverse lookup: which catalog item is this Dodo product? */
export function itemForDodoProduct(productId, mode, c = loadCatalog()) {
  for (const p of c.plans) if (p.dodo?.[mode] === productId) return { type: 'plan', item: p };
  for (const k of c.packs) if (k.dodo?.[mode] === productId) return { type: 'pack', item: k };
  return null;
}

/** Public shape (API /v2/plans → console Billing + /pricing). */
export function publicCatalog(c = loadCatalog(), { mode = 'test' } = {}) {
  const uu = c.unit.usd_list_value;
  const tiReq = c.meters.intelligence_request.uu;
  return {
    version: c.version,
    unit: c.unit,
    boundary: c.boundary,
    windows: c.windows,
    plans: c.plans.map((p) => {
      const ent = entitlementPlan(p.id, c);
      const econ = worstCase(p, c);
      return {
        id: p.id,
        name: p.name,
        kind: p.kind,
        priceUsd: p.price_usd,
        interval: p.interval || null,
        // Yearly variants point at their monthly plan (same allowance, billed yearly).
        basePlanId: p.base_plan || null,
        entitlementPlanId: ent.id,
        intro: p.intro ? { amountUsd: p.intro.amount_usd, days: p.intro.trial_period_days, copy: p.intro.copy } : null,
        allowance: {
          sessionUu: ent.allowance.session_uu,
          weeklyUu: ent.allowance.weekly_uu,
          sessionHours: c.windows.session_hours,
          // Plain-language equivalents (computed from the meter table, not constants).
          sessionTiRequests: Math.floor(ent.allowance.session_uu / tiReq),
          weeklyTiRequests: Math.floor(ent.allowance.weekly_uu / tiReq),
          weeklyListValueUsd: +(ent.allowance.weekly_uu * uu).toFixed(2),
        },
        limits: p.limits,
        inrPrice: p.inr_price ?? null,
        purchasable: p.kind === 'free' ? false : Boolean(p.dodo?.[mode]) && econ.gate === 'pass',
        economicsGate: econ.gate,
      };
    }),
    packs: c.packs.map((k) => ({
      id: k.id,
      name: k.name,
      priceUsd: k.price_usd,
      grantUu: k.grant_uu,
      tiRequests: Math.floor(k.grant_uu / tiReq),
      inrPrice: k.inr_price ?? null,
      purchasable: Boolean(k.dodo?.[mode]) && worstCase(k, c).gate === 'pass',
    })),
  };
}

export function __resetCatalog() { cached = null; }
