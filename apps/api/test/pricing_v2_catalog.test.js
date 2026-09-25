// PlanCatalog: validation, the economics gate, and doc/catalog parity.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalog, publicCatalog, __resetCatalog, loadCatalog } from '../src/pricing_v2/catalog.mjs';
import { worstCase } from '../src/pricing_v2/economics.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('Pricing V2 — PlanCatalog', () => {
  beforeEach(() => { delete process.env.PLAN_CATALOG_PATH; __resetCatalog(); });

  it('the shipped catalog is valid and every paid item passes the worst-case gate', () => {
    const c = loadCatalog();
    assert.deepEqual(validateCatalog(c), []);
    for (const i of [...c.plans, ...c.packs]) assert.equal(worstCase(i, c).gate, 'pass', i.id);
  });

  it('a plan whose worst case is negative is not purchasable', () => {
    const c = structuredClone(loadCatalog());
    c.economics.marginal_cost_usd_per_uu = 0.001; // at list value, Max's allowance costs more than its price
    const pub = publicCatalog(c, { mode: 'test' });
    assert.equal(pub.plans.find((p) => p.id === 'max').purchasable, false);
    assert.equal(pub.plans.find((p) => p.id === 'max').economicsGate, 'fail');
  });

  it('rejects malformed catalogs', () => {
    const c = structuredClone(loadCatalog());
    c.plans[1].allowance.weekly_uu = 1;
    c.plans[2].inr_price = 1580.5;
    c.packs.push({ ...c.packs[0] });
    const errs = validateCatalog(c).join(' | ');
    assert.match(errs, /allowance/);
    assert.match(errs, /inr_price/);
    assert.match(errs, /duplicate/);
  });

  it('Launch is Pro with a paid first cycle — same allowance, $5 intro, $19 renewal', () => {
    const pub = publicCatalog(loadCatalog(), { mode: 'test' });
    const [launch, pro] = ['launch', 'pro'].map((id) => pub.plans.find((p) => p.id === id));
    assert.deepEqual(launch.allowance, pro.allowance);
    assert.equal(launch.priceUsd, pro.priceUsd);
    assert.equal(launch.intro.amountUsd, 5);
    assert.equal(pro.allowance.weeklyTiRequests, 750);
  });

  it('docs/pricing-economics.md is regenerated from the catalog (no drift)', () => {
    const out = execFileSync(process.execPath, [path.join(here, '..', 'scripts', 'pricing', 'economics_report.mjs')], { encoding: 'utf8' });
    const committed = fs.readFileSync(path.join(here, '..', '..', '..', 'docs', 'pricing-economics.md'), 'utf8');
    assert.equal(committed.trim(), out.trim(), 'run: node apps/api/scripts/pricing/economics_report.mjs > docs/pricing-economics.md');
  });
});
