# HEALTH_PULSE — Scheduled System Monitor
# Model: Gemini | Schedule: every 30 min | Max turns: 4

## PROTOCOL

TURN 1 — Check system health:
  curl -s https://rpc.satelink.network/health
  curl -s https://rpc.satelink.network/api/status
  railway logs | grep -i "error\|crash\|FATAL\|OOM" | tail -10

TURN 2 — Evaluate:
If health.ok is false → create EVT-OPS incident.api_down → ENGINEERING_COMMANDER → REV-1
If error logs contain OOM/crash → create EVT-OPS incident.crash
If uptime < 300 seconds → create EVT-OPS incident.recent_restart
If all healthy → EXIT after writing to SENTINEL_STATUS.md

TURN 3 — Check Railway deployment status:
  Check if any recent commits are undeployed
  Check if Vercel frontend is responsive

TURN 4 — Write status:
Append to agent/memory/SENTINEL_STATUS.md:
{timestamp} | server:{ok/fail} | db:{ok/fail} | uptime:{seconds} | errors:{count}

EXIT.
