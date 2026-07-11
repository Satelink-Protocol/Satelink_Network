// Instant trial machine key — revenue sprint 2026-07-11.
//
// t1  {"mode":"instant"} → 201 with an API key, no wallet required, marked
//     instant_trial, per-key daily limit set via UPDATE
// t2  per-IP mint cap: third instant key from the same IP in a day → 429
// t3  wallet path untouched: missing signature still returns the
//     sign_message instruction (not an instant key)

import { expect } from 'chai';
import express from 'express';
import request from 'supertest';

describe('instant trial machine key', function () {
  this.timeout(15000);

  let app;
  const queries = [];
  const mockPool = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [] };
    },
  };

  before(async () => {
    const { createMachineV1Router } = await import('../src/routes/machine_onboarding.js');
    app = express();
    app.use('/v1', express.json(), createMachineV1Router(mockPool, null)); // no redis → in-memory mint guard
  });

  const mint = (ip = '7.7.7.7') =>
    request(app).post('/v1/machine/register')
      .set('X-Forwarded-For', ip)
      .set('Content-Type', 'application/json')
      .send({ mode: 'instant' });

  it('t1: instant mode issues a wallet-less trial key', async () => {
    const res = await mint('7.7.7.1');
    expect(res.status).to.equal(201);
    expect(res.body.api_key).to.be.a('string').and.match(/^sk_/);
    expect(res.body.identity).to.equal('instant_trial');
    expect(res.body.wallet_address).to.equal(null);
    expect(res.body.daily_limit).to.equal(1000);
    expect(res.body.next_steps[0]).to.include(res.body.api_key);
    // the trial marking hit the DB
    const upd = queries.find(q => /demand_source = 'instant_trial'/.test(q.sql));
    expect(upd, 'instant_trial UPDATE ran').to.exist;
    expect(upd.params[0]).to.equal(1000);
  });

  it('t2: third instant mint from one IP in a day → 429', async () => {
    expect((await mint('7.7.7.2')).status).to.equal(201);
    expect((await mint('7.7.7.2')).status).to.equal(201);
    const third = await mint('7.7.7.2');
    expect(third.status).to.equal(429);
    expect(third.body.error).to.equal('instant_key_limit');
  });

  it('t3: wallet path unchanged — missing signature returns sign_message', async () => {
    const res = await request(app).post('/v1/machine/register')
      .set('Content-Type', 'application/json')
      .send({ wallet_address: '0x' + '1'.repeat(40) });
    expect(res.status).to.equal(400);
    expect(res.body.error).to.equal('signature_required');
    expect(res.body.sign_message).to.include('satelink:register:');
  });
});
