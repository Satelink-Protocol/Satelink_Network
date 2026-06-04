# REVENUE_PULSE — Scheduled Revenue Monitor
# Model: Gemini (cheap) | Schedule: every 30 min | Max turns: 4

## PROTOCOL (execute every run, 4 turns max)

TURN 1 — Check production revenue state:
Run these checks (use Bash tool):
  curl -s https://rpc.satelink.network/stats/free-tier
  curl -s https://rpc.satelink.network/system/revenue-anomalies
  curl -s https://rpc.satelink.network/system/epoch-scheduler
  railway logs | grep "DepositListener" | tail -3

TURN 2 — Evaluate and decide:
If nearLimitIPs > 15 AND no EVT-REV exists for conversion → create new event
If lastHour revenue dropped >50% from avgHourly → create REV-1 event
If DepositListener not alive → create REV-1 event immediately
If all healthy → write one line to agent/memory/REVENUE_LOG.md and EXIT

TURN 3 — Write event to ACTIVE_EVENTS.md if needed:
Format: | EVT-REV-{timestamp} | revenue.{type} | REV-{1/2/3} | ECONOMY_COMMANDER | NEW | ...

TURN 4 — Update REVENUE_LOG.md:
Format: {timestamp} | IPs:{activeIPs} | NearLimit:{nearLimitIPs} | Revenue:{lastHour}/hr | Listener:{alive/dead}

EXIT immediately after turn 4. Never exceed 4 turns.
