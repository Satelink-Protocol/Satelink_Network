# SECURITY AUDIT REPORT — C3-2
Date: 2026-05-31
Method: Static codebase analysis (no Trivy/Infisical — CLI not available)

## Hardcoded Secrets Scan
- Files with potential hardcoded secrets: 
  - `apps/api/src/core/routes.js`: Hardcoded fallback `const ADMIN_API_KEY = process.env.ADMIN_API_KEY || "test-admin-secret";` (Vulnerability: High)
  - `apps/api/src/utils/scripts/smoke_settlement.js`: Hardcoded private keys `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` (Vulnerability: Medium, test scripts only)
  - `apps/api/src/utils/scripts/deploy_settlement.js`: Hardcoded private keys (Vulnerability: Medium, test scripts only)
- .env.staging.example: CLEAN (placeholders used correctly)

## Security Middleware Status
- Rate limiting: PRESENT (`apps/api/src/security/middleware/rate_limits.js` used in routes)
- JWT auth: PRESENT (`apps/api/src/security/auth_middleware.js` hardened with `validateEnv()`)
- CORS: PRESENT (`apps/api/src/security/middleware.js` configured with `CORS_ORIGINS`)
- HTTP security headers: PRESENT (Helmet.js configured in `apps/api/src/security/middleware.js`)
- Payload limit: `100kb confirmed` (Note: SAT-56/SAT-81 previously set to 10mb, but SAT-98 restricted it back to 100kb for security)

## Env Var Coverage
- JWT_SECRET: PRESENT in example
- DATABASE_URL: PRESENT
- REDIS_URL: PRESENT
- RPC_URL: PRESENT
- TREASURY_ADDRESS: PRESENT
- CHAIN_ID: PRESENT

## P0 Issues (from audit-p0-findings.md)
- NONE FOUND (File does not exist, checked `docs/security/` and `CLAUDE.md` for active issues)

## Verdict: YELLOW
The security foundation is solid with hardened JWT middleware and rate limiting. However, a high-severity hardcoded fallback for `ADMIN_API_KEY` was found in core routes. Additionally, there is a discrepancy between the 10mb payload limit mentioned in recent tasks and the current 100kb limit (likely intentional but should be clarified).

## Recommended Actions
1. **Remove hardcoded fallback** for `ADMIN_API_KEY` in `apps/api/src/core/routes.js`. It should hard-fail if the env var is missing in production.
2. **Clarify Payload Limit**: Confirm if 100kb is sufficient for all workloads; if 10mb is required (as per SAT-81), update `apps/api/src/security/middleware.js`.
3. **Externalize Test Keys**: Move hardcoded private keys in `smoke_settlement.js` and `deploy_settlement.js` to a `test.env` or similar ignored file.
