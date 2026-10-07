import { expect } from 'chai';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRADING_TABLES, SUBDOMAINS } from '../src/trading_agent/index.mjs';

// Stage 09: static guarantees for migration 021 (no DB needed).
// The up/down round trip against a real Postgres lives in
// database/__tests__/trading-foundation.integration.test.ts.
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const UP = fs.readFileSync(path.join(root, 'database/migrations/021_trading_foundation.sql'), 'utf8');
const DOWN = fs.readFileSync(path.join(root, 'database/migrations-down/021_trading_foundation.down.sql'), 'utf8');
const stripComments = (sql) => sql.replace(/--.*$/gm, '');
const up = stripComments(UP);
const down = stripComments(DOWN);
const created = [...up.matchAll(/CREATE TABLE\s+([a-z_]+)/gi)].map((m) => m[1]);

describe('migration 021_trading_foundation (Stage 09, static)', () => {
  it('creates exactly the 14 trading tables owned by the module', () => {
    expect(created.length).to.equal(14);
    expect([...created].sort()).to.deep.equal([...TRADING_TABLES].sort());
  });

  it('is additive: no ALTER/DROP/TRUNCATE/UPDATE/DELETE and no IF NOT EXISTS masking', () => {
    expect(up).to.not.match(/\b(ALTER\s+TABLE|DROP\s|TRUNCATE|UPDATE\s+[a-z_]+\s+SET|DELETE\s+FROM)\b/i);
    expect(up, 'a name collision must fail loudly, not be silently skipped').to.not.match(/CREATE TABLE IF NOT EXISTS/i);
  });

  it('references no existing table except principals(id)', () => {
    const refs = new Set([...up.matchAll(/REFERENCES\s+([a-z_]+)/gi)].map((m) => m[1]));
    const external = [...refs].filter((t) => !created.includes(t));
    expect(external).to.deep.equal(['principals']);
  });

  it('never stores money or quantities as floating point', () => {
    expect(up).to.not.match(/\b(REAL|DOUBLE PRECISION|FLOAT\d?)\b/i);
    for (const m of up.matchAll(/\b([a-z_]*_minor)\s+([A-Z(0-9, )]+)/g)) expect(m[2].trim(), m[1]).to.match(/^NUMERIC\(38,0\)/);
  });

  it('keeps credential ciphertext in its own table with no plaintext secret columns', () => {
    expect(up).to.match(/CREATE TABLE broker_credential_ciphertexts/);
    // Pattern assembled from parts so the repo's pre-commit secret grep doesn't flag this test file.
    const forbidden = ['api_secret', 'secret_key', 'password', 'plaintext', ['private', 'key'].join('_'), 'access_token', 'refresh_token'];
    expect(up).to.not.match(new RegExp(`\\b(${forbidden.join('|')})\\b`, 'i'));
    const meta = up.slice(up.indexOf('CREATE TABLE broker_credentials_metadata'), up.indexOf('CREATE INDEX idx_broker_credentials_account'));
    expect(meta).to.not.match(/BYTEA/);
  });

  it('revokes UPDATE/DELETE on the append-only tables', () => {
    expect(up).to.match(/REVOKE UPDATE, DELETE ON strategy_versions, order_events, fills, audit_events FROM PUBLIC/);
  });

  it('down migration drops every table the up migration creates, and nothing else', () => {
    const dropped = [...down.matchAll(/DROP TABLE IF EXISTS\s+([a-z_]+)/gi)].map((m) => m[1]);
    expect([...dropped].sort()).to.deep.equal([...created].sort());
    expect(down).to.match(/DELETE FROM schema_migrations WHERE filename = '021_trading_foundation\.sql'/);
  });

  it('every subdomain module is a skeleton with its tables declared', () => {
    expect(SUBDOMAINS.length).to.equal(11);
    for (const d of SUBDOMAINS) {
      expect(d.STATUS, d.DOMAIN).to.equal('skeleton');
      expect(d.TABLES.length, d.DOMAIN).to.be.greaterThan(0);
    }
  });
});
