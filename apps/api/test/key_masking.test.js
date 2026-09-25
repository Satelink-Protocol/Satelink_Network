// TI_KEY_LOGGING — no code path may persist or emit a full API key outside the
// identifier columns (api_credits.api_key and the columns that reference it).
import { expect } from 'chai';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import { keyHint, keyRef, redactKeys, KEY_PATTERN } from '../src/security/key_mask.mjs';
import { createIntelligenceRouter } from '../src/routes/intelligence_route.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..', 'src');
const KEY = 'sk_basic_' + '0123456789abcdef'.repeat(3);

describe('key masking (TI_KEY_LOGGING)', () => {
  it('keyHint is the display fingerprint; keyRef is stable and non-reversible', () => {
    expect(keyHint(KEY)).to.equal('sk_basic_…cdef');
    expect(keyRef(KEY)).to.match(/^kref_[0-9a-f]{16}$/);
    expect(keyRef(KEY)).to.equal(keyRef(KEY));
    expect(keyRef(KEY)).to.not.include(KEY.slice(9, 20));
    expect(redactKeys(`boom on ${KEY} and ${KEY}`)).to.equal('boom on sk_basic_…cdef and sk_basic_…cdef');
  });

  it('static: no source file interpolates a raw key into logs, alerts, ids or cache names', () => {
    // The only allowed raw uses: sending the key as the credential it is.
    const ALLOW = [
      /Authorization['"]?\s*:\s*`Bearer \$\{apiKey\}`/, // sending the key as the credential
      /(usage|example): `.*X-API-Key: \$\{apiKey\}/,       // the one-time creation response to the key's owner
    ];
    const offenders = [];
    const walk = (d) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) { if (!/node_modules|utils[/\\]scripts|public/.test(p)) walk(p); continue; }
        if (!/\.(m?js|cjs)$/.test(f.name)) continue;
        fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
          if (/\$\{(apiKey|api_key|apiKeyHint)(\.slice\([^)]*\))?\}/.test(line) && !ALLOW.some((a) => a.test(line))) {
            offenders.push(`${path.relative(SRC, p)}:${i + 1}: ${line.trim().slice(0, 120)}`);
          }
        });
      }
    };
    walk(SRC);
    expect(offenders, offenders.join('\n')).to.deep.equal([]);
  });

  it('Trading Intelligence stores a request_id without the key', async () => {
    const revenue = [];
    const pool = {
      async query(sql, params = []) {
        const s = sql.replace(/\s+/g, ' ').trim();
        if (s.includes('FROM api_credits WHERE api_key')) return { rows: [{ api_key: KEY, tier: 'basic', daily_limit: 1000, credits_usdt: 5, status: 'active' }] };
        if (s.includes('FROM api_usage_daily WHERE api_key')) return { rows: [{ request_count: 0 }] };
        if (s.startsWith('UPDATE api_credits SET credits_usdt = credits_usdt -')) return { rowCount: 1, rows: [{ credits_usdt: 4.99 }] };
        if (s.startsWith('INSERT INTO revenue_events_v2')) { revenue.push(params); return { rowCount: 1, rows: [] }; }
        if (s.includes('FROM intelligence_snapshots')) return { rows: [{ payload: { symbols: [] }, source_rows: 1, captured_at: new Date(1_700_000_000_000 - 1000) }] };
        return { rows: [] };
      },
    };
    const app = express();
    app.use('/v1', createIntelligenceRouter(pool, { now: () => 1_700_000_000_000 }));
    const res = await request(app).get('/v1/intelligence/funding-rate-heatmap').set('x-api-key', KEY);
    expect(res.status).to.equal(200);
    await new Promise((r) => setTimeout(r, 20)); // revenue write is fire-and-forget
    expect(revenue.length).to.equal(1);
    const requestId = revenue[0].find((p) => typeof p === 'string' && p.startsWith('intel:'));
    expect(requestId).to.match(/^intel:funding-rate-heatmap:kref_[0-9a-f]{16}:\d+:[0-9a-f]{6}$/);
    for (const p of revenue[0]) if (typeof p === 'string' && p !== KEY) expect(p.match(KEY_PATTERN) ?? []).to.deep.equal([]);
  });

  it('the shared revenue writer rewrites any request_id that still carries the key', async () => {
    const { recordRpcRevenue } = await import('../src/workloads/rpc_gateway/rpc_billing.js');
    const inserts = [];
    const pool = { async query(sql, params) { if (/INSERT INTO revenue_events_v2/.test(sql)) inserts.push(params); return { rows: [], rowCount: 1 }; } };
    await recordRpcRevenue({ pool, chain: null, method: 'm', apiKey: KEY, source: 's', requestId: `legacy:${KEY}:1`, amountUsdt: 0.01, opType: 'intelligence' });
    const ids = inserts.flat().filter((p) => typeof p === 'string' && p.startsWith('legacy:'));
    expect(ids).to.deep.equal([`legacy:${keyRef(KEY)}:1`]);
  });
});
