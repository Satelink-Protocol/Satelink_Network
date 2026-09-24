import { expect } from 'chai';
import {
  isBetterAuthEnabled, emailEnabled, getBetterAuth, mountBetterAuth, trustedOrigins, __reset,
} from '../src/auth/better_auth.mjs';

// Config-gating only (no live OAuth, no DB boot). The full provider flows are
// validated on the Vercel/Railway preview with real secrets (§9).
describe('better_auth config gating (Track B P5)', () => {
  const saved = {};
  const KEYS = ['AUTH_ENABLED', 'BETTER_AUTH_SECRET', 'RESEND_API_KEY', 'BETTER_AUTH_TRUSTED_ORIGINS'];
  beforeEach(() => { for (const k of KEYS) saved[k] = process.env[k]; __reset(); });
  afterEach(() => {
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    __reset();
  });

  it('is disabled by default', async () => {
    delete process.env.AUTH_ENABLED;
    delete process.env.BETTER_AUTH_SECRET;
    expect(isBetterAuthEnabled()).to.equal(false);
    expect(await getBetterAuth({})).to.equal(null);
    const app = { all() { throw new Error('should not mount'); } };
    expect(mountBetterAuth(app, {})).to.equal(false);
  });

  it('needs BOTH the flag and the secret', () => {
    process.env.AUTH_ENABLED = 'true';
    delete process.env.BETTER_AUTH_SECRET;
    expect(isBetterAuthEnabled()).to.equal(false);
    process.env.BETTER_AUTH_SECRET = 's3cret';
    expect(isBetterAuthEnabled()).to.equal(true);
  });

  it('emailEnabled tracks RESEND_API_KEY', () => {
    delete process.env.RESEND_API_KEY;
    expect(emailEnabled()).to.equal(false);
    process.env.RESEND_API_KEY = 're_test';
    expect(emailEnabled()).to.equal(true);
  });

  it('mounts a lazy /api/identity/* handler only when enabled (founder-confirmed namespace, 2026-09-23 — never /api/auth)', () => {
    process.env.AUTH_ENABLED = 'true';
    process.env.BETTER_AUTH_SECRET = 's3cret';
    const routes = [];
    const app = { all: (path) => routes.push(path) };
    expect(mountBetterAuth(app, {})).to.equal(true);
    expect(routes).to.deep.equal(['/api/identity/*splat']);
  });

  it('trusts the web and console hosts by default; env list overrides', () => {
    delete process.env.BETTER_AUTH_TRUSTED_ORIGINS;
    expect(trustedOrigins()).to.include.members(['https://satelink.network', 'https://console.satelink.network']);
    process.env.BETTER_AUTH_TRUSTED_ORIGINS = 'https://a.example, https://b.example';
    expect(trustedOrigins()).to.deep.equal(['https://a.example', 'https://b.example']);
  });
});
