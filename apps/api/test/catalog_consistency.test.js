// Wave 2 / C8 — the PlanCatalog is the single source of every public price.
// Fails CI when (1) the catalog drifts from the constants that actually charge,
// (2) a discovery endpoint shows a number the catalog does not, or (3) web,
// console or docs copy states an RPC price / bundle / free tier the catalog
// does not. Hermetic: no DB, no network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import { loadCatalog, __resetCatalog } from '../src/pricing_v2/catalog.mjs';
import { railPrices } from '../src/pricing_v2/rails.mjs';
import { PRICE_PER_CALL_USDT } from '../src/billing/credit_service.mjs';
import { getX402Config } from '../src/payments/x402/config.js';
import { METRICS } from '../src/intelligence/compute.js';
import { createWellKnownX402Router } from '../src/routes/well_known_x402.js';
import { createWellKnownSatelinkRouter, createMachineV1Router } from '../src/routes/machine_onboarding.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..', '..');
const X402_ENV = ['X402_BUNDLE_PRICE_USD', 'X402_BUNDLE_CALLS'];

describe('Catalog consistency (C8): one price, every surface', () => {
  const saved = {};
  before(() => { for (const k of X402_ENV) { saved[k] = process.env[k]; delete process.env[k]; } __resetCatalog(); });
  after(() => { for (const k of X402_ENV) if (saved[k] !== undefined) process.env[k] = saved[k]; });

  it('catalog rails == the constants enforcement charges', () => {
    const c = loadCatalog();
    const r = railPrices(c, {});
    assert.equal(r.rpc_credits.price_usd_per_call, PRICE_PER_CALL_USDT, 'credit_service.PRICE_PER_CALL_USDT');
    const x = getX402Config();
    assert.equal(r.rpc_x402_bundle.price_usd, Number(x.bundlePriceUsd), 'x402 bundle price default');
    assert.equal(r.rpc_x402_bundle.calls, x.bundleCalls, 'x402 bundle calls default');
    for (const [id, m] of Object.entries(METRICS)) assert.equal(m.price_usdt, r.intelligence_credits.price_usd_per_request, `TI metric ${id}`);
  });

  it('/.well-known/x402 shows the catalog prices, with rail + challenge labels (C5)', async () => {
    const app = express(); app.use('/.well-known', createWellKnownX402Router());
    const body = (await request(app).get('/.well-known/x402')).body;
    const r = railPrices();
    const rpc = body.routes.find((x) => x.resource.endsWith('/rpc/polygon'));
    assert.equal(rpc.price, `$${r.rpc_x402_bundle.price_usd.toFixed(2)} = ${r.rpc_x402_bundle.calls.toLocaleString('en-US')} calls`);
    assert.deepEqual([rpc.rail, rpc.x402_challenge], ['x402', true]);
    for (const ti of body.routes.filter((x) => x.resource.includes('/v1/intelligence/'))) {
      assert.equal(ti.price, `$${r.intelligence_credits.price_usd_per_request}/call`);
      assert.deepEqual([ti.rail, ti.x402_challenge], ['api_credits', false], 'TI is metered from credits, not an x402 challenge');
    }
    assert.deepEqual(body.rails, r);
  });

  it('/.well-known/satelink.json and /v1/pricing show the catalog prices', async () => {
    const r = railPrices();
    const app = express();
    app.use('/.well-known', createWellKnownSatelinkRouter());
    app.use('/v1', createMachineV1Router({ query: async () => ({ rows: [], rowCount: 0 }) }));
    const m = (await request(app).get('/.well-known/satelink.json')).body;
    assert.equal(m.pricing.price_per_call_usdt, r.rpc_credits.price_usd_per_call);
    assert.equal(m.pricing.x402_bundle, `$${r.rpc_x402_bundle.price_usd.toFixed(2)} = ${r.rpc_x402_bundle.calls.toLocaleString('en-US')} calls (USDC on Base)`);
    assert.deepEqual(m.pricing.rails, r);
    const p = (await request(app).get('/v1/pricing')).body;
    assert.equal(p.price_per_call_usdt, r.rpc_credits.price_usd_per_call);
    for (const t of p.tiers) assert.equal(t.cost_per_call_usdt, r.rpc_credits.price_usd_per_call, t.tier);
    assert.equal(p.intelligence.price_usdt_per_call, r.intelligence_credits.price_usd_per_request);
    assert.deepEqual(p.rails, r);
  });

  // ── Copy on web, console and docs ──────────────────────────────────────────
  const SURFACES = ['apps/web/src', 'apps/console/src', 'docs/quick-start.md', 'docs/pricing.md', 'docs/api-reference.md', 'docs/sdk-guide.md', 'docs/README.md'];
  // Lines that legitimately show other numbers: operator share, samples, UI kits, admin internals.
  const EXEMPT_FILE = /(\/design\/|\/styleguide\/|\/admin\/|\.bak$|\.test\.|EarningsEstimator|node-operators\.md|revenue-model\.md)/;
  const EXEMPT_LINE = /operator|share|sample|illustrative|example|competitor|median|vs\.? /i;
  function files(p) {
    const abs = path.join(ROOT, p);
    if (!fs.existsSync(abs)) return [];
    if (fs.statSync(abs).isFile()) return [abs];
    return fs.readdirSync(abs, { recursive: true }).map((f) => path.join(abs, String(f)))
      .filter((f) => /\.(tsx?|jsx?|mdx?)$/.test(f) && !f.includes('node_modules') && fs.statSync(f).isFile());
  }
  function scan(test) {
    const bad = [];
    for (const s of SURFACES) for (const f of files(s)) {
      const rel = path.relative(ROOT, f);
      if (EXEMPT_FILE.test(rel)) continue;
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => { const why = test(line); if (why && !EXEMPT_LINE.test(line)) bad.push(`${rel}:${i + 1} ${why}`); });
    }
    return bad;
  }

  it('every RPC per-call price in copy equals the catalog credits price', () => {
    const want = railPrices().rpc_credits.price_usd_per_call;
    const bad = scan((line) => {
      if (!/call/i.test(line)) return null;
      const nums = [...line.matchAll(/\$\s?0\.0000\d+/g)].map((m) => Number(m[0].replace(/[$\s]/g, '')));
      const off = nums.filter((n) => n !== want);
      return off.length ? `per-call ${off.join(', ')} ≠ ${want}` : null;
    });
    assert.deepEqual(bad, [], 'RPC price drift');
  });

  it('every x402 bundle in copy equals the catalog bundle', () => {
    const r = railPrices().rpc_x402_bundle;
    const bad = scan((line) => {
      const m = line.match(/\$\s?(\d+\.\d+)\s?=\s?([\d,]+)\s+(?:RPC\s+)?calls/i);
      if (!m) return null;
      return Number(m[1]) === r.price_usd && Number(m[2].replace(/,/g, '')) === r.calls ? null : `bundle ${m[0]}`;
    });
    assert.deepEqual(bad, [], 'x402 bundle drift');
  });

  it('no copy promises free RPC calls (C3: RPC has no free tier)', () => {
    const bad = scan((line) => (/\d[\d,]*[- ]calls?\/day free tier|free tier of [\d,]+ (rpc )?calls|[\d,]+ free (rpc )?calls/i.test(line) ? 'free RPC claim' : null));
    assert.deepEqual(bad, [], 'free-tier drift');
  });
});
