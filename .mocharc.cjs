'use strict';
// P0-1 (2026-09): tests must NEVER touch production Postgres.
//
// Previously this file did a bare `require('dotenv').config()`, which loaded the
// developer's `.env` — and `.env` holds a PROD (Railway) DATABASE_URL. A plain
// `npm test` on a clean checkout could therefore write to production.
//
// Now we load `.env.test` EXCLUSIVELY (never `.env`) and then FAIL LOUDLY —
// before any pg Pool/Client can be constructed — if the resolved DATABASE_URL
// is not a local/ephemeral host. This runs at mocharc load, ahead of every test
// file, so the guard fires before the first connection opens.
const path = require('path');
const fs = require('fs');

// .env.test is git-ignored (the repo's pre-commit gate blocks committing any
// .env file). Copy the template in apps/api/test/README.md to ./.env.test to
// run the DB-integration tests locally. It is loaded with override:true so it
// is AUTHORITATIVE even when the ambient shell exports a (prod) DATABASE_URL —
// some dev shells export one from ~/.zshrc. The guard below validates the
// final resolved value either way.
const envTestPath = path.resolve(__dirname, '.env.test');
if (fs.existsSync(envTestPath)) {
  require('dotenv').config({ path: envTestPath, override: true });
} else {
  // Do NOT fall back to `.env` (prod). Overwrite any ambient DATABASE_URL with
  // empty so a stray `import 'dotenv/config'` in a test file cannot later load
  // the prod URL; DB-integration tests skip when DATABASE_URL is falsy.
  process.env.DATABASE_URL = '';
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test-only-jwt-secret-not-a-real-secret';
  // eslint-disable-next-line no-console
  console.warn(
    '[test] .env.test not found — DB-integration tests will SKIP. ' +
    'Copy the template in apps/api/test/README.md to ./.env.test (LOCAL Postgres).'
  );
}

// Fail-loud guard: the resolved DATABASE_URL must be a local host and must never
// look like a Railway/managed production host. Throws before any connection.
(function assertNotProductionDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url) return; // nothing configured → integration tests skip; nothing to protect

  let host = '';
  try {
    host = new URL(url).hostname;
  } catch (_) {
    throw new Error(`[test-guard] DATABASE_URL is not a valid URL; refusing to run tests.`);
  }

  const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);
  const extraAllowed = (process.env.TEST_DB_ALLOWED_HOSTS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const isLocal = LOCAL_HOSTS.has(host) || extraAllowed.includes(host);

  // Managed/production host fingerprints (defense in depth on top of the
  // local-only allowlist).
  const looksProduction = /railway|rlwy\.net|\.proxy\.|render\.com|supabase\.co|neon\.tech|amazonaws\.com|\.rds\.|azure/i.test(url);

  if (looksProduction || !isLocal) {
    throw new Error(
      '[test-guard] Refusing to run the test suite against a non-local database.\n' +
      `  DATABASE_URL host = "${host}"  (looksProduction=${looksProduction})\n` +
      '  Tests may only use localhost / 127.0.0.1 (or hosts in TEST_DB_ALLOWED_HOSTS).\n' +
      '  Point DATABASE_URL in .env.test at a LOCAL / ephemeral Postgres.'
    );
  }
})();

module.exports = {
  timeout: 15000,
  file: [],
};
