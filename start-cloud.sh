#!/bin/sh
echo "Starting Paperclip on Railway..."
echo "PORT: ${PORT:-8081}"
echo "DATABASE_URL set: $(echo $DATABASE_URL | sed 's/:\/\/.*@/:\/\/***@/')"

# Auto-reset DB if tables exist but migration journal is missing (failed partial bootstrap)
if [ -n "$DATABASE_URL" ]; then
  TABLE_COUNT=$(psql "$DATABASE_URL" -t -c \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'" \
    2>/dev/null | tr -d ' \n')
  JOURNAL_COUNT=$(psql "$DATABASE_URL" -t -c \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='__drizzle_migrations'" \
    2>/dev/null | tr -d ' \n')

  echo "DB state: tables=$TABLE_COUNT journal=$JOURNAL_COUNT"

  if [ "${TABLE_COUNT:-0}" -gt "0" ] && [ "${JOURNAL_COUNT:-0}" = "0" ]; then
    echo "DB has $TABLE_COUNT tables but no migration journal — resetting schema for clean start..."
    psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public;"
    echo "DB schema reset complete."
  fi
fi

exec paperclipai onboard --yes --run
