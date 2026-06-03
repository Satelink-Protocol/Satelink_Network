# SENTINEL TASK — SLOT 4
Status: WAITING
Model: Gemini Flash Lite (cheap — pure health check)
Max Turns: 3

## JOB
Health check. Write status. Stop.

## EXACT STEPS
1. curl -s https://rpc.satelink.network/health
2. curl -s https://rpc.satelink.network/api/status
3. Write to agent/memory/SENTINEL_STATUS.md:

# SENTINEL STATUS — [timestamp]
/health: [response or UNREACHABLE]
/api/status: [response or UNREACHABLE]
Epoch: [epoch number from status response]
Overall: [HEALTHY / DEGRADED / DOWN]

4. Write to agent/memory/PROGRESS.md:
   DONE | slot=4 | task=health_check | status=[HEALTHY/DEGRADED/DOWN] | timestamp=$(date)
5. STOP.

## EXIT CONDITION
SENTINEL_STATUS.md written. DONE in PROGRESS.md. STOP.
