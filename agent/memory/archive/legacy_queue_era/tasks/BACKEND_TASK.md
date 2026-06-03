# BACKEND_WORKER TASK — SAT-213: ECONOMY_COMMANDER
# Assigned: 2026-06-03T00:00:00Z
# Parent Issue: SAT-213 (CEO)

## OBJECTIVE
Deploy ECONOMY_COMMANDER — the Machine Revenue Operating System for Satelink.

ECONOMY_COMMANDER is a new orchestrator module that starts and coordinates all
revenue-generating autonomous systems in one place, and exposes a status endpoint
so the admin panel can show the economic health of the protocol.

## CONTEXT
- Current autonomous systems exist in `apps/api/src/autonomous/` (sentinel, auto_scaler,
  rpc_healer, revenue_anomaly, treasury_monitor, capacity_alerter)
- Revenue classification lives in `apps/api/src/autonomous_revenue/revenue_source_classifier.js`
- Workload acquisition engine: `apps/api/src/workloads/workload_acquisition_engine.js`
- Economics constants: `apps/api/src/core/config/economics.js` (50/30/20 split)
- Server startup: `apps/api/server.js` (check for where autonomous systems are started)
- The server uses ESM imports (import/export syntax, NOT require())
- All DB calls MUST use await

## TASKS (in order)

### Task 1: Audit what autonomous systems are already started
1. Read `apps/api/server.js` — find where autonomous systems are imported and started
2. Read `apps/api/src/autonomous/index.js` — list all exported starters
3. Note which are already called in server.js and which are not

### Task 2: Create ECONOMY_COMMANDER module
Create new file: `apps/api/src/autonomous/economy_commander.js`

It must:
- Import all revenue-related autonomous starters from `./index.js`:
  `startRevenueMonitor`, `startTreasuryMonitor`, `startCapacityAlerter`
- Import `WorkloadAcquisitionEngine` from `../workloads/workload_acquisition_engine.js`
- Export `startEconomyCommander(db, opsEngine)` function that:
  1. Starts startRevenueMonitor(db)
  2. Starts startTreasuryMonitor(db)
  3. Starts startCapacityAlerter(db)
  4. Starts WorkloadAcquisitionEngine if not already running
  5. Logs "[ECONOMY_COMMANDER] Revenue OS online — all systems started"
- Export `getEconomyStatus()` function that returns:
  ```json
  {
    "economy_commander": "online",
    "started_at": "<ISO timestamp>",
    "systems": {
      "revenue_monitor": "running",
      "treasury_monitor": "running",
      "capacity_alerter": "running",
      "workload_acquisition": "running"
    }
  }
  ```

### Task 3: Wire ECONOMY_COMMANDER into server startup
1. In `apps/api/server.js`, add import:
   `import { startEconomyCommander } from './src/autonomous/economy_commander.js';`
2. Call `await startEconomyCommander(db, opsEngine)` in the server's listen callback,
   AFTER the database connection is confirmed.
3. Make this non-fatal: wrap in try/catch and log any failure without crashing the server.

### Task 4: Add admin status endpoint
In `apps/api/src/autonomous/economy_commander.js`, also export a router factory:
`createEconomyCommanderRouter()` → Express Router with:
  - GET /admin/economy/status → calls getEconomyStatus() and returns JSON

Wire this route in `apps/api/src/core/routes.js`:
```js
import { createEconomyCommanderRouter } from '../autonomous/economy_commander.js';
// inside attachRoutes():
app.use('/admin/economy', requireAdmin, createEconomyCommanderRouter());
```

### Task 5: Verify and commit
1. Run: `node --check apps/api/src/autonomous/economy_commander.js`
2. Run: `node --check apps/api/server.js`
3. If checks pass, commit to feature branch (already on feature/SAT-167-fix-auth-login-404
   or create feature/SAT-213-economy-commander)
4. Commit message: `feat(SAT-213): deploy ECONOMY_COMMANDER revenue OS`

## EXIT CRITERIA
Write to `agent/memory/PROGRESS.md`:
```
DONE | slot=SAT-213 | task=economy_commander_deploy | result=<summary> | commit=<hash> | timestamp=<ISO>
```

## SKILLS REFERENCE
- agent/memory/skills/SATELINK_ARCHITECTURE.md
- agent/memory/skills/SATELINK_REVENUE_MODEL.md
- agent/memory/skills/AGENT_UNIVERSAL_RULES.md

## RULES
- ALL DB calls must use await — zero exceptions
- No hardcoded secrets — check process.env
- No SQLite — PostgreSQL only
- NEVER commit to main — use feature branch
- Commit format: feat(SAT-213): description
- EVOLVE DON'T REBUILD — add the new module, don't rewrite existing ones
- If WorkloadAcquisitionEngine constructor requires parameters you don't have,
  wrap in try/catch and log WARN — don't block server startup
