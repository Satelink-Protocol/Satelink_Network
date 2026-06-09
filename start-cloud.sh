#!/bin/sh
echo "Starting Paperclip on Railway..."
echo "PORT: ${PORT:-3100}"
echo "DATABASE_URL set: $(echo $DATABASE_URL | sed 's/:\/\/.*@/:\/\/***@/')"
exec paperclipai onboard --yes --run
