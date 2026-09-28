import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { identityClientIp, resolveClientIp, isCloudflare, CLIENT_IP_HEADER } from '../src/auth/client_ip.mjs';
import { createSessionReadLimiter, SESSION_READ_LIMIT } from '../src/auth/session_read_limit.mjs';
import { RATE_LIMIT } from '../src/auth/better_auth.mjs';

// The console calls /api/identity/get-session from Vercel's shared egress IPs.
// 2026-09-28: Better Auth's per-IP limit (20/min) returned 429 after ~11 calls
// and signed users out. Session reads are now limited per session; the IP that
// Better Auth's own limits use comes only from trusted sources.
const VERCEL_IP = '76.76.21.21';
const cookieFor = (s) => `__Secure-satelink.session_token=${s}; other=x`;

function app({ now } = {}) {
  const a = express();
  const limiter = createSessionReadLimiter({ now });
  a.all('/api/identity/*splat', identityClientIp, limiter, (req, res) => res.json({ ok: true, ip: req.headers[CLIENT_IP_HEADER] || null }));
  return a;
}

describe('identity rate limits — per session for reads, trusted IP for the rest', () => {
  const saved = process.env.CONSOLE_S2S_SECRET;
  beforeEach(() => { process.env.CONSOLE_S2S_SECRET = 'test-s2s-secret-0123456789'; });
  afterEach(() => { if (saved === undefined) delete process.env.CONSOLE_S2S_SECRET; else process.env.CONSOLE_S2S_SECRET = saved; });

  it('a 12th (and 40th) rapid get-session from one signed-in user succeeds, even from a shared Vercel IP', async () => {
    const a = app();
    for (let i = 1; i <= 40; i++) {
      const r = await request(a).get('/api/identity/get-session').set('X-Forwarded-For', VERCEL_IP).set('Cookie', cookieFor('user-1'));
      expect(r.status, `call ${i}`).to.equal(200);
    }
  });

  it('many users behind the same Vercel IP do not share a bucket', async () => {
    const a = app();
    for (let u = 0; u < 30; u++) {
      for (let i = 0; i < 12; i++) {
        const r = await request(a).get('/api/identity/get-session').set('X-Forwarded-For', VERCEL_IP).set('Cookie', cookieFor('user-' + u));
        expect(r.status).to.equal(200);
      }
    }
  });

  it('a flood from ONE session is still throttled (301st call in the window → 429 with Retry-After)', async () => {
    let t = 1_000_000;
    const a = app({ now: () => t });
    for (let i = 0; i < SESSION_READ_LIMIT.max; i++) {
      const r = await request(a).get('/api/identity/get-session').set('Cookie', cookieFor('flooder'));
      expect(r.status).to.equal(200);
    }
    const blocked = await request(a).get('/api/identity/get-session').set('Cookie', cookieFor('flooder'));
    expect(blocked.status).to.equal(429);
    expect(blocked.body.error).to.equal('rate_limited');
    expect(Number(blocked.headers['retry-after'])).to.be.within(1, SESSION_READ_LIMIT.window);
    // another session is unaffected
    const other = await request(a).get('/api/identity/get-session').set('Cookie', cookieFor('someone-else'));
    expect(other.status).to.equal(200);
    // the window resets
    t += SESSION_READ_LIMIT.window * 1000;
    const later = await request(a).get('/api/identity/get-session').set('Cookie', cookieFor('flooder'));
    expect(later.status).to.equal(200);
  });

  it('list-sessions and list-accounts share the session budget; sign-in is NOT handled here (Better Auth per-IP limit applies)', async () => {
    let t = 5_000_000;
    const a = app({ now: () => t });
    for (let i = 0; i < SESSION_READ_LIMIT.max; i++) {
      const p = ['/get-session', '/list-sessions', '/list-accounts'][i % 3];
      expect((await request(a).get('/api/identity' + p).set('Cookie', cookieFor('s'))).status).to.equal(200);
    }
    expect((await request(a).get('/api/identity/list-accounts').set('Cookie', cookieFor('s'))).status).to.equal(429);
    expect((await request(a).post('/api/identity/sign-in/email').set('Cookie', cookieFor('s'))).status).to.equal(200);
  });

  it('Better Auth keeps its strict per-IP limit for everything except the three session reads', () => {
    expect(RATE_LIMIT).to.include({ enabled: true, window: 60, max: 20 });
    expect(Object.keys(RATE_LIMIT.customRules).sort()).to.deep.equal(['/get-session', '/list-accounts', '/list-sessions']);
    for (const p of Object.keys(RATE_LIMIT.customRules)) expect(p).to.not.match(/sign-in|sign-up|magic|two-factor|reset|verify|revoke/);
  });

  describe('trusted client IP', () => {
    it('drops a client-supplied X-Satelink-Client-Ip', async () => {
      const r = await request(app()).get('/api/identity/sign-in/email').set('X-Forwarded-For', '203.0.113.9').set(CLIENT_IP_HEADER, '1.2.3.4');
      expect(r.body.ip).to.equal('203.0.113.9');
    });

    it('ignores X-Satelink-End-User-Ip without the console secret (wrong or missing)', async () => {
      for (const auth of [undefined, 'wrong-secret']) {
        const req = request(app()).get('/api/identity/sign-in/email').set('X-Forwarded-For', VERCEL_IP).set('X-Satelink-End-User-Ip', '198.51.100.7');
        if (auth) req.set('X-Satelink-Console-Auth', auth);
        expect((await req).body.ip).to.equal(VERCEL_IP);
      }
    });

    it('honours X-Satelink-End-User-Ip only with the correct console secret', async () => {
      const r = await request(app()).get('/api/identity/sign-in/email').set('X-Forwarded-For', VERCEL_IP)
        .set('X-Satelink-Console-Auth', 'test-s2s-secret-0123456789').set('X-Satelink-End-User-Ip', '198.51.100.7');
      expect(r.body.ip).to.equal('198.51.100.7');
    });

    it('never honours the end-user header when CONSOLE_S2S_SECRET is unset', () => {
      delete process.env.CONSOLE_S2S_SECRET;
      const ip = resolveClientIp({ headers: { 'x-forwarded-for': VERCEL_IP, 'x-satelink-console-auth': '', 'x-satelink-end-user-ip': '198.51.100.7' } });
      expect(ip).to.equal(VERCEL_IP);
    });

    it('uses CF-Connecting-IP only when the connecting peer is a Cloudflare edge', () => {
      expect(isCloudflare('172.70.1.1')).to.equal(true);
      expect(isCloudflare('203.0.113.9')).to.equal(false);
      expect(resolveClientIp({ headers: { 'x-forwarded-for': '172.70.1.1', 'cf-connecting-ip': '198.51.100.8' } })).to.equal('198.51.100.8');
      expect(resolveClientIp({ headers: { 'x-forwarded-for': '203.0.113.9', 'cf-connecting-ip': '198.51.100.8' } })).to.equal('203.0.113.9');
    });

    it('rejects non-IP garbage in every header', () => {
      expect(resolveClientIp({ headers: { 'x-forwarded-for': 'evil, 1.1.1.1' }, socket: { remoteAddress: '::ffff:10.0.0.5' } })).to.equal('10.0.0.5');
    });
  });
});
