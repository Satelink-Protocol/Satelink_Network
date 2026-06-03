# CONVERSION_MONITOR TASK — SLOT 3
Status: WAITING
Model: Gemini Flash Lite (cheap monitoring — no Sonnet needed here)
Max Turns: 4

## JOB
Poll free-tier status ONCE. Write report. Stop.

## EXACT STEPS
1. Run: curl -s https://rpc.satelink.network/system/free-tier
2. Parse the JSON response
3. Write to agent/memory/CONVERSIONS.md:

# CONVERSION REPORT — [timestamp]
Total IPs tracked: [number]
IPs at 0-50% of limit: [count]
IPs at 50-80% of limit: [count]
IPs at 80-90% of limit: [count]
IPs at 90-99% of limit (warm leads): [count]
IPs at 100% limit (upgrade needed): [count]
Total free calls today: [number]

4. Write to agent/memory/PROGRESS.md:
   DONE | slot=3 | task=conversion_check | near_limit=[count] | timestamp=$(date)
5. STOP.

## EXIT CONDITION
CONVERSIONS.md written. DONE in PROGRESS.md. STOP immediately.
