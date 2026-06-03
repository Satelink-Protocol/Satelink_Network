# SECURITY_WORKER TASK — SLOT C3-2 (RESCOPED)
# Assigned by: CEO (SAT-94 queue advance — rescoped from SAT-74)
# Created: 2026-05-30
# Queue slot: C3-2 (Cycle 3, second slot)
# Mapped to: BACKEND_WORKER
# Rescoped reason: Trivy/Infisical CLI not available; use static codebase analysis

---

## OBJECTIVE
Static security audit — no external tools required.
Scan codebase for hardcoded secrets, check security middleware, verify env var coverage.
Write agent/memory/SECURITY_REPORT.md.

---

## TASKS

### Task 1: Hardcoded Secret Scan
- Search for hardcoded secrets in source code:
  ```
  grep -r "password\s*=\s*['\"]" src/ apps/ --include="*.js" --include="*.mjs" -l
  grep -r "secret\s*=\s*['\"]" src/ apps/ --include="*.js" --include="*.mjs" -l
  grep -r "apikey\|api_key\|APIKEY" src/ apps/ --include="*.js" --include="*.mjs" -il
  grep -r "0x[a-fA-F0-9]{64}" src/ apps/ --include="*.js" --include="*.mjs" -l
  ```
- Check .env.staging.example for any real credentials (should only have placeholders)
- Check if any real private keys or credentials appear in non-.env files

### Task 2: Security Middleware Review
- Read src/middleware/ directory — verify these exist and are wired:
  - Rate limiting middleware
  - JWT auth middleware
  - CORS configuration
  - Helmet.js or equivalent HTTP headers
- Check apps/api/src/security/middleware.js — confirm payload limit is 10mb
- Note any missing security controls

### Task 3: Env Var Coverage Check
- Read .env.staging.example — list all vars defined there
- Verify required vars from CLAUDE.md are present (check var names only, NOT values):
  - JWT_SECRET
  - DATABASE_URL
  - REDIS_URL
  - RPC_URL
  - TREASURY_ADDRESS
  - CHAIN_ID
- Check src/config/ for any hard-coded connection strings or secrets

### Task 4: Known P0 Issues Triage
- Read docs/audit-p0-findings.md if it exists
- Summarize any open P0 security items
- Note which ones are still unresolved

### Task 5: Write SECURITY_REPORT.md
- Create agent/memory/SECURITY_REPORT.md
- Format:
  ```
  # SECURITY AUDIT REPORT — C3-2
  Date: <ISO>
  Method: Static codebase analysis (no Trivy/Infisical — CLI not available)

  ## Hardcoded Secrets Scan
  - Files with potential hardcoded secrets: <list or NONE>
  - .env.staging.example: <CLEAN / ISSUES FOUND>

  ## Security Middleware Status
  - Rate limiting: <PRESENT / MISSING>
  - JWT auth: <PRESENT / MISSING>
  - CORS: <PRESENT / MISSING>
  - HTTP security headers: <PRESENT / MISSING>
  - Payload limit: <10mb confirmed / OTHER>

  ## Env Var Coverage
  - JWT_SECRET: <PRESENT in example / MISSING>
  - DATABASE_URL: <PRESENT / MISSING>
  - REDIS_URL: <PRESENT / MISSING>
  - RPC_URL: <PRESENT / MISSING>
  - TREASURY_ADDRESS: <PRESENT / MISSING>
  - CHAIN_ID: <PRESENT / MISSING>

  ## P0 Issues (from audit-p0-findings.md)
  - <list open items or NONE FOUND>

  ## Verdict: GREEN / YELLOW / RED
  <explanation>

  ## Recommended Actions
  - <up to 3 specific actions>
  ```

---

## EXIT CRITERIA
- [ ] Hardcoded secret scan run on src/ and apps/
- [ ] Security middleware verified (exists + wired)
- [ ] Env var coverage confirmed
- [ ] agent/memory/SECURITY_REPORT.md written
- [ ] Write DONE entry to agent/memory/PROGRESS.md:
      `DONE | slot=C3-2 | task=security_audit | result=<verdict> | timestamp=<ISO>`

---

## CONTEXT
- Satelink API runs on Railway (Node.js 20 + Express, port 8080)
- This is static analysis only — do not install tools, do not make external calls
- Read files directly using Read/Grep tools
- Max 12 turns — be methodical, write the report, STOP
- Next slot after your DONE: C3-3 BACKEND_WORKER node registration test
