import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { createCreditsRouter } from '../src/routes/credits.js';

// T-1.4 security fix: GET /credits/balance resolves an api_key account via
// the X-Api-Key HEADER, never a ?apiKey= query param (which would land in
// access logs and any Referer the page's outbound requests send).
function makeDb(rows) {
  return {
    async query(sql) {
      if (sql.includes('FROM api_credits WHERE api_key')) return { rows };
      throw new Error('unexpected SQL: ' + sql);
    },
  };
}

function buildApp(db) {
  const app = express();
  app.use('/credits', createCreditsRouter(db, { error() {} }));
  return app;
}

describe('GET /credits/balance — X-Api-Key header lookup', () => {
  it('resolves balance via the X-Api-Key header', async () => {
    const app = buildApp(makeDb([{ api_key: 'sk_dodo_abc', credits_usdt: 9.99, total_deposited: 9.99, total_spent: 0, tier: 'free', last_used: null }]));
    const res = await request(app).get('/credits/balance').set('X-Api-Key', 'sk_dodo_abc');
    expect(res.status).to.equal(200);
    expect(res.body.api_key).to.equal('sk_dodo_abc');
    expect(res.body.balance_usdt).to.equal(9.99);
    expect(res.body.status).to.equal('funded');
  });

  it('404s for an unknown api_key', async () => {
    const app = buildApp(makeDb([]));
    const res = await request(app).get('/credits/balance').set('X-Api-Key', 'sk_dodo_unknown');
    expect(res.status).to.equal(404);
  });

  it('rejects a header value that is not an sk_ key', async () => {
    const app = buildApp(makeDb([]));
    const res = await request(app).get('/credits/balance').set('X-Api-Key', 'not-a-key');
    expect(res.status).to.equal(400);
  });

  it('a ?apiKey= query param is IGNORED (not the lookup path anymore) — falls through to the wallet-required error', async () => {
    const app = buildApp(makeDb([{ api_key: 'sk_dodo_abc', credits_usdt: 9.99 }]));
    const res = await request(app).get('/credits/balance?apiKey=sk_dodo_abc');
    expect(res.status).to.equal(400);
    expect(res.body.error).to.match(/wallet/i);
  });
});
