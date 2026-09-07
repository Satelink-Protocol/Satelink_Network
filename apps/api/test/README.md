# apps/api tests — local setup

## Safety: tests never touch production (P0-1, 2026-09)

`.mocharc.cjs` loads **`.env.test` exclusively** (never `.env`, which points at a
prod Railway DB) and then **fails loudly — before any connection opens — if the
resolved `DATABASE_URL` is not a local host** or looks like a Railway/managed
host. So a plain `npm test` can never write to production, even though some dev
shells export a prod `DATABASE_URL` from `~/.zshrc`.

`.env.test` is **git-ignored** — the repo's pre-commit gate
(`scripts/pre-commit-gate.sh`) blocks committing any `.env*` file (only
`.env.example` is allowed). Create it locally from the template below.

## One-time local DB provisioning

```bash
createdb satelink_test
psql -d satelink_test -f apps/api/test/schema/billing_test_schema.sql
```

## `.env.test` template (create at repo root — LOCAL values only, NO secrets)

```dotenv
NODE_ENV=test
SATELINK_MODE=simulation

# LOCAL / ephemeral Postgres ONLY. No user → node-pg uses PGUSER / OS user.
DATABASE_URL=postgresql://127.0.0.1:5432/satelink_test

# Non-secret placeholders for module-load auth code under test.
JWT_SECRET=test-only-jwt-secret-not-a-real-secret
ADMIN_SECRET_TOKEN=test-only-admin-token

SETTLEMENT_DRY_RUN=1
REDIS_URL=

# Optional: extra local hosts the guard should allow (comma-separated).
# TEST_DB_ALLOWED_HOSTS=
```

Without `.env.test`, DB-integration tests **skip** (they guard on
`process.env.DATABASE_URL`); pure-logic tests still run.

## Running

```bash
cd apps/api
../../node_modules/.bin/mocha --exit 'test/**/*.test.js'      # full suite
../../node_modules/.bin/mocha 'test/c1_payer_address.test.js' # C1 regression
```
