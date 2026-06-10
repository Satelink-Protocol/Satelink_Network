#!/bin/sh
echo "Starting Paperclip on Railway..."
echo "PORT: ${PORT:-3100}"

node -e "
const {Client} = require('pg');
const c = new Client({connectionString: process.env.DATABASE_URL});
c.connect()
  .then(() => c.query('CREATE SCHEMA IF NOT EXISTS drizzle'))
  .then(() => c.query('CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)'))
  .then(() => { console.log('[startup] Migration journal ready'); return c.end(); })
  .catch(e => console.error('[startup]', e.message));
" 2>/dev/null

exec paperclipai onboard --yes --bind lan --run
