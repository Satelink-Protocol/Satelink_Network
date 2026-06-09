#!/bin/sh
echo "Starting Paperclip on Railway..."
echo "PORT: ${PORT:-8081}"
echo "DATABASE_URL set: $(echo $DATABASE_URL | sed 's/:\/\/.*@/:\/\/***@/')"

# Pre-write cloud config so paperclipai binds to 0.0.0.0 (required for Railway healthcheck)
PAPERCLIP_HOME=/root/.paperclip/instances/default
mkdir -p "$PAPERCLIP_HOME/data/storage" "$PAPERCLIP_HOME/logs" "$PAPERCLIP_HOME/secrets"
cat > "$PAPERCLIP_HOME/config.json" << 'ENDCONFIG'
{
  "$meta": {"version": 1, "source": "cloud-init"},
  "database": {"mode": "postgres"},
  "logging": {
    "mode": "file",
    "logDir": "/root/.paperclip/instances/default/logs"
  },
  "server": {
    "deploymentMode": "authenticated",
    "exposure": "public",
    "bind": "lan",
    "host": "0.0.0.0",
    "port": 8081,
    "allowedHostnames": [],
    "serveUi": true
  },
  "auth": {"baseUrlMode": "auto", "disableSignUp": false},
  "telemetry": {"enabled": false},
  "storage": {
    "provider": "local_disk",
    "localDisk": {"baseDir": "/root/.paperclip/instances/default/data/storage"},
    "s3": {"bucket": "paperclip", "region": "us-east-1", "prefix": "", "forcePathStyle": false}
  },
  "secrets": {
    "provider": "local_encrypted",
    "strictMode": false,
    "localEncrypted": {"keyFilePath": "/root/.paperclip/instances/default/secrets/master.key"}
  }
}
ENDCONFIG
echo "Cloud config written — authenticated mode on 0.0.0.0:8081"

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
