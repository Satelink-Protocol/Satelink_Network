# apps/mcp-server/Dockerfile — Satelink MCP HTTP server (POST /execute + /mcp).
# Build context is the monorepo ROOT so the workspace lockfile is available:
#   docker build -f apps/mcp-server/Dockerfile -t satelink-mcp .
FROM node:20-slim AS base
WORKDIR /app

# Install only this package's deps (self-contained: it is an x402 CLIENT of the
# production rail, so it needs no DB, no contracts, no facilitator credentials).
COPY apps/mcp-server/package.json ./apps/mcp-server/package.json
WORKDIR /app/apps/mcp-server
RUN npm install --omit=dev --no-audit --no-fund

COPY apps/mcp-server/ ./

ENV NODE_ENV=production
ENV PORT=8402
EXPOSE 8402

# Liveness: /healthz reports wallet + payment status.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT||8402) +'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "http.mjs"]
