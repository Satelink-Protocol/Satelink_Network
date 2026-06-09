#!/bin/sh
# SATELINK PAPERCLIP — CLOUD STARTUP
# Railway injects DATABASE_URL automatically
echo "Starting Paperclip on Railway..."
echo "DATABASE_URL set: $(echo $DATABASE_URL | sed 's/:\/\/.*@/:\/\/***@/')"
echo "PORT: ${PORT:-3100}"
exec paperclipai onboard --yes --bind lan --run
