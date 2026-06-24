# ALERTS

- 2026-05-29T01:35:00Z: Schedulers (health, epoch) are not running. Sentinel status may be stale. Severity: Medium.
- 2026-05-29T01:45:00Z: RESOLVED: Schedulers and API server recovered following investigation (SAT-40).
- 2026-05-29T05:35:00Z: RESOLVED: Railway deployment healthcheck recovered (SAT-49).
- 2026-05-29T06:30:00Z: Backend API /health returning UI HTML instead of JSON status. Severity: High.
- 2026-05-29T06:45:00Z: FIXED: Updated /health handler in core/routes.js to correctly await DB check (async/await). Monitoring for resolution.
- 2026-05-29T07:30:00Z: PERSISTENT: /health still returning UI HTML. /api/status returning 404. Backend routes are likely not being correctly mounted or are being intercepted. Severity: High. Requires immediate BACKEND_WORKER intervention.
- 2026-05-29T08:30:00Z: RESOLVED (SAT-55): Port conflict identified — Paperclip (PID 34755) holds port 8080. Satelink API port changed to 8081 in .env and .env.example. Backend can now bind to 8081 without conflict.
2026-06-04T08:31:00Z | ERROR: invalid block range params | FILE: ethers/lib.esm/providers/provider-jsonrpc.js | FREQUENCY: 1
