# Deterministic build for @satelink/api.
#
# apps/api is plain ESM Node ("type":"module", entry server.js) inside an npm
# workspace monorepo — there is NO TypeScript/dist build step; production runs
# `node server.js` (this mirrors the known-good Nixpacks build). Railway is
# configured with RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile, so this file
# existing AND building is deploy-critical.

FROM node:20.18-slim AS base
WORKDIR /app
# Pin npm to the version declared in the root package.json for reproducibility.
RUN npm install -g npm@11.6.2

# Install the full workspace dependency graph deterministically from the
# committed lockfile. npm requires every workspace manifest to be present to
# link the graph, so copy the repo first. (.railwayignore keeps node_modules,
# .git, dist, build, and coverage out of the build context.)
COPY . .
RUN npm ci

ENV NODE_ENV=production
WORKDIR /app/apps/api
# Informational only — Railway injects PORT at runtime; server.js binds to it.
EXPOSE 8080
CMD ["node", "server.js"]
