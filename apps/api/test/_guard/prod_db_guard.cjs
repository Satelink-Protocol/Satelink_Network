// Fail-closed production-database guard for the apps/api mocha suite.
//
// Loaded with `mocha --require test/_guard/prod_db_guard.cjs` (package.json
// test scripts + scripts/ci-baseline-check.sh), so it runs before any test
// file is imported. It refuses to start the suite unless every Postgres URL
// the tests could use points at an allow-listed LOCAL host.
//
// Why an allowlist, not a denylist of production hosts: Railway rotates proxy
// hostnames, and a denylist that misses one new name fails OPEN. On
// 2026-09-27 a login shell exported the production DATABASE_URL into every
// terminal; a plain `npm test` would have run write-heavy tests against prod.
//
// It also loads `.env` exactly as the tests do (`import 'dotenv/config'` in
// x402_rail.test.js): dotenv never overrides a set variable, so running it
// here first means the guard sees the same values the tests will see —
// including the case where DATABASE_URL is unset and apps/api/.env supplies
// the production URL.
//
// Escape hatch for a non-local TEST database (e.g. a CI service container on
// a named host): TEST_DB_ALLOWED_HOSTS=host1,host2. Never list a prod host.
'use strict';

const LOCAL_HOSTS = new Set(['', 'localhost', '127.0.0.1', '::1', '[::1]']);
const URL_VARS = ['DATABASE_URL', 'DATABASE_PUBLIC_URL', 'TEST_DATABASE_URL', 'POSTGRES_URL'];

function allowedHosts(env) {
  const extra = (env.TEST_DB_ALLOWED_HOSTS || '')
    .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  return new Set([...LOCAL_HOSTS, ...extra]);
}

// Host of a libpq-style URL. A unix-socket URL (`postgres:///db?host=/tmp`)
// has an empty authority host; its `host` query param is a filesystem path.
function hostOf(raw) {
  let u;
  try { u = new URL(raw); } catch { return { error: 'unparseable URL' }; }
  const qHost = u.searchParams.get('host');
  if (!u.hostname && qHost && qHost.startsWith('/')) return { host: '' };
  return { host: (u.hostname || qHost || '').toLowerCase() };
}

function check(env) {
  const allow = allowedHosts(env);
  const problems = [];
  for (const name of URL_VARS) {
    const raw = env[name];
    if (!raw) continue;
    const { host, error } = hostOf(raw);
    // Report the variable name and host only — never the URL (credentials).
    if (error) problems.push(`${name}: ${error}`);
    else if (!allow.has(host)) problems.push(`${name} → host "${host}"`);
  }
  // libpq env fallback used by pg when a connection string omits the host.
  const pgHost = (env.PGHOST || '').toLowerCase();
  if (pgHost && !pgHost.startsWith('/') && !allow.has(pgHost)) problems.push(`PGHOST → host "${pgHost}"`);
  return problems;
}

module.exports = { check, hostOf };

if (require.main === module || !process.env.PROD_DB_GUARD_NO_AUTORUN) {
  try { require('dotenv').config({ quiet: true }); } catch { /* dotenv absent: nothing to load */ }
  const problems = check(process.env);
  if (problems.length) {
    process.stderr.write(
      '\n[prod-db-guard] REFUSING to run tests: a database URL points at a non-local host.\n' +
      problems.map((p) => '  - ' + p).join('\n') +
      '\nPoint DATABASE_URL at a local test DB (e.g. postgres:///satelink_test?host=/tmp),' +
      '\nor unset it. For a dedicated remote TEST database set TEST_DB_ALLOWED_HOSTS.\n\n'
    );
    process.exit(1);
  }
}
