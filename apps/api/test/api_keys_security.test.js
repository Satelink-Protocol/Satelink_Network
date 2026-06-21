import { expect } from 'chai';
import express from 'express';
import request from 'supertest';

import {
  apiKeyCreateLimiter,
  apiKeyDepositLimiter,
  apiKeyReadLimiter,
} from '../src/security/middleware/rate_limits.js';

import {
  extractApiKey,
  isValidKeyFormat,
  checkDepositOwnership,
  hasEnoughConfirmations,
  confirmationCount,
  MIN_CONFIRMATIONS,
} from '../src/billing/deposit_validation.mjs';

import { createSimpleApiKeysRouter } from '../src/billing/api_keys_route.mjs';

// Security regression suite for the /api/keys hardening sprint.
// Pins the contracts for: deposit ownership binding (P0-1), rate limiting
// (P0-2), header-based key transport (P0-3), generic errors (P1-4), and
// confirmation depth (P1-5). If any guard is weakened or removed, these fail.

const VALID_KEY = 'sk_free_' + 'a'.repeat(48);
const WALLET = '0xAbC0000000000000000000000000000000000123';

describe('api_keys security hardening', () => {

  // ---------------------------------------------------------------- P0-1
  describe('P0-1 — deposit ownership binding', () => {
    it('rejects when the key has no registered wallet (wallet mandatory)', () => {
      const r = checkDepositOwnership(WALLET, null);
      expect(r.ok).to.equal(false);
      expect(r.code).to.equal('wallet_not_registered');
    });

    it('rejects when the on-chain sender != registered wallet', () => {
      const r = checkDepositOwnership('0xdead000000000000000000000000000000000000', WALLET);
      expect(r.ok).to.equal(false);
      expect(r.code).to.equal('wallet_mismatch');
    });

    it('accepts an exact match, case-insensitively', () => {
      const r = checkDepositOwnership(WALLET.toLowerCase(), WALLET.toUpperCase());
      expect(r.ok).to.equal(true);
    });

    it('rejects when the sender address cannot be determined', () => {
      const r = checkDepositOwnership('', WALLET);
      expect(r.ok).to.equal(false);
      expect(r.code).to.equal('sender_unknown');
    });
  });

  // ---------------------------------------------------------------- P1-5
  describe('P1-5 — confirmation depth', () => {
    it('requires a minimum within the 20-30 band', () => {
      expect(MIN_CONFIRMATIONS).to.be.at.least(20);
      expect(MIN_CONFIRMATIONS).to.be.at.most(30);
    });

    it('counts confirmations inclusively', () => {
      expect(confirmationCount(100, 100)).to.equal(1);
      expect(confirmationCount(124, 100)).to.equal(25);
    });

    it('rejects a tx shallower than the minimum', () => {
      // head 120, receipt 100 => 21 confirmations < 25
      expect(hasEnoughConfirmations(120, 100)).to.equal(false);
    });

    it('accepts a tx at or beyond the minimum', () => {
      expect(hasEnoughConfirmations(124, 100)).to.equal(true); // exactly 25
      expect(hasEnoughConfirmations(500, 100)).to.equal(true);
    });

    it('rejects non-finite block numbers', () => {
      expect(hasEnoughConfirmations(NaN, 100)).to.equal(false);
    });
  });

  // ---------------------------------------------------------------- P0-3
  describe('P0-3 — key transport (header, not URL path)', () => {
    it('extractApiKey reads the X-API-Key header', () => {
      const req = { get: (h) => (h === 'X-API-Key' ? VALID_KEY : undefined), headers: {} };
      expect(extractApiKey(req)).to.equal(VALID_KEY);
    });

    it('extractApiKey falls back to the request body', () => {
      const req = { get: () => undefined, body: { api_key: VALID_KEY } };
      expect(extractApiKey(req)).to.equal(VALID_KEY);
    });

    it('isValidKeyFormat accepts known prefixes, rejects junk', () => {
      expect(isValidKeyFormat(VALID_KEY)).to.equal(true);
      expect(isValidKeyFormat('not-a-key')).to.equal(false);
      expect(isValidKeyFormat('')).to.equal(false);
    });
  });

  // ----------------------------------------------- router integration
  describe('router transport + ownership regression', () => {
    function buildApp(pool) {
      const app = express();
      app.use(express.json());
      app.use('/api/keys', createSimpleApiKeysRouter(pool));
      return app;
    }
    const okPool = (rows = []) => ({ query: async () => ({ rows }) });

    it('serves /api/keys/deposits when the key is in the X-API-Key header', async () => {
      const app = buildApp(okPool([{ tx_hash: '0xabc', amount_usdt: '10.0', created_at: 't' }]));
      const res = await request(app).get('/api/keys/deposits').set('X-API-Key', VALID_KEY);
      expect(res.status).to.equal(200);
      expect(res.body.ok).to.equal(true);
      expect(res.body.deposits).to.have.length(1);
    });

    it('rejects /api/keys/deposits with no API key', async () => {
      const res = await request(buildApp(okPool())).get('/api/keys/deposits');
      expect(res.status).to.equal(400);
    });

    it('no longer exposes the key-in-URL path form (404)', async () => {
      const res = await request(buildApp(okPool())).get(`/api/keys/${VALID_KEY}/deposits`);
      expect(res.status).to.equal(404);
    });

    // -------------------------------------------------------------- P1-4
    it('P1-4 — does not leak raw DB error detail to the client', async () => {
      const leakyPool = {
        query: async (q) => {
          if (/api_deposits/.test(q)) throw new Error('SECRET pg detail: relation does not exist');
          return { rows: [] };
        },
      };
      const res = await request(buildApp(leakyPool)).get('/api/keys/deposits').set('X-API-Key', VALID_KEY);
      expect(res.status).to.equal(500);
      expect(JSON.stringify(res.body)).to.not.match(/SECRET/);
      expect(res.body.error).to.equal('Failed to fetch deposits');
    });
  });

  // ---------------------------------------------------------------- P0-2
  describe('P0-2 — rate limiting', () => {
    it('apiKeyCreateLimiter caps key creation per IP (30/window)', async () => {
      const app = express();
      app.post('/api/keys', apiKeyCreateLimiter, (_req, res) => res.json({ ok: true }));
      for (let i = 0; i < 30; i++) {
        const r = await request(app).post('/api/keys').send({});
        expect(r.status, `request ${i + 1} should pass`).to.equal(200);
      }
      const blocked = await request(app).post('/api/keys').send({});
      expect(blocked.status).to.equal(429);
    });

    it('apiKeyDepositLimiter caps deposits at 10/min and buckets per X-API-Key', async () => {
      const app = express();
      app.post('/api/keys/deposit', apiKeyDepositLimiter, (_req, res) => res.json({ ok: true }));
      for (let i = 0; i < 10; i++) {
        const r = await request(app).post('/api/keys/deposit').set('X-API-Key', 'keyA').send({});
        expect(r.status, `keyA request ${i + 1}`).to.equal(200);
      }
      const blockedA = await request(app).post('/api/keys/deposit').set('X-API-Key', 'keyA').send({});
      expect(blockedA.status).to.equal(429);

      const okB = await request(app).post('/api/keys/deposit').set('X-API-Key', 'keyB').send({});
      expect(okB.status).to.equal(200);
    });

    it('apiKeyReadLimiter caps financial reads at 60/min', async () => {
      const app = express();
      app.get('/api/keys/deposits', apiKeyReadLimiter, (_req, res) => res.json({ ok: true }));
      for (let i = 0; i < 60; i++) {
        const r = await request(app).get('/api/keys/deposits').set('X-API-Key', 'readKey');
        expect(r.status, `read ${i + 1}`).to.equal(200);
      }
      const blocked = await request(app).get('/api/keys/deposits').set('X-API-Key', 'readKey');
      expect(blocked.status).to.equal(429);
    });
  });
});
