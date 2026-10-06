import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { requireAdminAuth } from '../src/admin/admin_router.js';

// Gate 0 B-03 hotfix (2026-10-07) — audit 06 S-05 / S-06.
//   S-05: POST /system/epoch-scheduler/trigger and /system/data-retention/trigger
//         were unauthenticated (epoch payables write; audit-log prune + VACUUM).
//         They must sit behind requireAdminAuth — the SAME middleware
//         app_factory.mjs puts in front of /admin.
//   S-06: the api_phase3 router (/node/me/withdraw, /node/me/claim, ...) must
//         not be mounted. Its file is kept.
//
// server.js cannot be booted in a unit test (start() opens the DB, Redis and
// the epoch/settlement schedulers), so the mount lines are pinned at source
// level and the middleware they use is exercised behaviourally on routes of
// the same shape.

const here = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(here, '..');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const serverSrc = stripComments(readFileSync(path.join(API_ROOT, 'server.js'), 'utf8'));
const factorySrc = stripComments(readFileSync(path.join(API_ROOT, 'app_factory.mjs'), 'utf8'));

const TRIGGERS = ['/system/epoch-scheduler/trigger', '/system/data-retention/trigger'];

describe('Gate 0 B-03: /system/*/trigger routes require admin auth (S-05)', () => {
  it('every /system/*/trigger registration in server.js lists requireAdminAuth first', () => {
    const regs = [...serverSrc.matchAll(/app\.(?:post|put|patch|delete|get|all|use)\(\s*['"`](\/system\/[^'"`]*trigger[^'"`]*)['"`]\s*,\s*([A-Za-z_$][\w$]*)?/g)];
    expect(regs.map((m) => m[1]).sort()).to.deep.equal([...TRIGGERS].sort());
    for (const m of regs) expect(m[2], `${m[1]} middleware`).to.equal('requireAdminAuth');
  });

  it('server.js imports requireAdminAuth from the same module app_factory uses for /admin', () => {
    expect(serverSrc).to.match(/import\s*\{\s*requireAdminAuth\s*\}\s*from\s*["']\.\/src\/admin\/admin_router\.js["']/);
    expect(factorySrc).to.match(/requireAdminAuth\s*\}\s*from\s*['"]\.\/src\/admin\/admin_router\.js['"]/);
  });

  describe('behaviour of the mounted guard', () => {
    const TOKEN = 'test-only-admin-secret-gate0';
    const saved = process.env.ADMIN_SECRET_TOKEN;
    let calls;
    let app;

    before(() => { process.env.ADMIN_SECRET_TOKEN = TOKEN; });
    after(() => {
      if (saved === undefined) delete process.env.ADMIN_SECRET_TOKEN;
      else process.env.ADMIN_SECRET_TOKEN = saved;
    });
    beforeEach(() => {
      calls = 0;
      app = express();
      app.use(express.json());
      for (const p of TRIGGERS) {
        app.post(p, requireAdminAuth, (req, res) => { calls += 1; res.json({ ok: true }); });
      }
    });

    for (const p of TRIGGERS) {
      it(`${p}: no token → 401, job not run`, async () => {
        const res = await request(app).post(p).send({});
        expect(res.status).to.equal(401);
        expect(calls).to.equal(0);
      });

      it(`${p}: wrong token → 401, job not run`, async () => {
        const res = await request(app).post(p).set('x-admin-token', 'nope').send({});
        expect(res.status).to.equal(401);
        expect(calls).to.equal(0);
      });

      it(`${p}: ?token= query param is NOT accepted → 401`, async () => {
        const res = await request(app).post(`${p}?token=${TOKEN}`).send({});
        expect(res.status).to.equal(401);
        expect(calls).to.equal(0);
      });

      it(`${p}: admin x-admin-token → previous behaviour (handler runs)`, async () => {
        const res = await request(app).post(p).set('x-admin-token', TOKEN).send({});
        expect(res.status).to.equal(200);
        expect(calls).to.equal(1);
      });

      it(`${p}: admin Bearer token → handler runs`, async () => {
        const res = await request(app).post(p).set('Authorization', `Bearer ${TOKEN}`).send({});
        expect(res.status).to.equal(200);
        expect(calls).to.equal(1);
      });
    }

    it('ADMIN_SECRET_TOKEN unset → 503 (deny), job not run', async () => {
      delete process.env.ADMIN_SECRET_TOKEN;
      const res = await request(app).post(TRIGGERS[0]).set('x-admin-token', '').send({});
      process.env.ADMIN_SECRET_TOKEN = TOKEN;
      expect(res.status).to.equal(503);
      expect(calls).to.equal(0);
    });
  });
});

describe('Gate 0 B-03: api_phase3 router is unmounted (S-06)', () => {
  it('server.js neither imports nor mounts createPhase3Router', () => {
    expect(serverSrc).to.not.match(/createPhase3Router/);
    expect(serverSrc).to.not.match(/api_phase3/);
  });

  it('app_factory.mjs does not mount it either', () => {
    expect(factorySrc).to.not.match(/createPhase3Router|api_phase3/);
  });

  it('the router file itself is kept (unmount only)', () => {
    expect(existsSync(path.join(API_ROOT, 'src/gateway/routes/api_phase3.js'))).to.equal(true);
  });
});
