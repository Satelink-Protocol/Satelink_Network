# CODEBASE MAP — WHERE THE MONEY LIVES

## REVENUE PATH FILES (highest priority)

Billing middleware:
  core/middleware/freeTierGate.js (or similar) — enforces 500 call free limit
  Check: is BILLING_ENABLED flag read here?

Auth:
  apps/api/src/routes/node_auth_route.mjs — JWT auth for node operators
  apps/api/src/app_factory.mjs — router mounting

RPC Gateway:
  apps/api/server.js — main entry point
  core/routes.js or apps/api/src/core/routes.js — route definitions
  /rpc endpoint — where all the money flows through

Settlement:
  contracts/ — Solidity: RevenueVault, settlement adapters
  services/ — settlement service

Epoch system:
  src/jobs/ or scripts/ — epoch aggregation jobs

Environment (CRITICAL vars):
  BILLING_ENABLED=true — must be true in Railway production
  REVENUE_MODE=collected — must be set
  JWT_SECRET — must be set in Railway
  DATABASE_URL — production Postgres

## ADMIN / MONITORING

  apps/web/src/app/admin/ — admin dashboard
  apps/web/src/app/dashboard/ — operator dashboard
  GET /system/free-tier — shows near-limit IPs (conversion targets)
  GET /api/status — system status
  GET /health — health check
  GET /rpc/metrics — RPC call metrics

## AGENT MEMORY FILES

  agent/memory/events/ACTIVE_EVENTS.md — current work queue
  agent/memory/events/RESOLUTION_LOG.md — completed work
  agent/memory/REVENUE_LOG.md — revenue truth
  agent/memory/CONVERSIONS.md — conversion targets
  agent/memory/ALERTS.md — production alerts
  agent/memory/SECURITY_REPORT.md — security posture

## GIT

  Branch: enterprise-os-runtime-migration
  Production: main branch → Railway auto-deploy
  Recent commits: see git log --oneline -10
