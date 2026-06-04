# SECURITY_PULSE — Daily Security Monitor
# Model: Gemini | Schedule: every 24h | Max turns: 6

## PROTOCOL

TURN 1 — Check treasury:
  curl -s https://rpc.satelink.network/credits/balance?wallet=0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3
  Check if RevenueVault balance matches expected from epoch data

TURN 2 — Check for secrets in recent commits:
  git log --oneline -5
  git diff HEAD~5 | grep -i "secret\|password\|private_key\|0x[a-f0-9]{64}"

TURN 3 — npm audit critical:
  npm audit --audit-level=critical 2>/dev/null | head -20

TURN 4 — Check Railway env for required vars:
  railway variables | grep -E "BILLING|JWT|POLYGON_RPC|REDIS" | wc -l
  (should be at least 5)

TURN 5 — Evaluate and create events:
If treasury mismatch → create EVT-SEC treasury.mismatch → SECURITY_COMMANDER → SEC-1
If critical npm vulns in billing path → create EVT-SEC security.critical_vuln
If Railway missing vars → create EVT-SEC security.missing_env

TURN 6 — Write to SECURITY_REPORT.md and EXIT.
