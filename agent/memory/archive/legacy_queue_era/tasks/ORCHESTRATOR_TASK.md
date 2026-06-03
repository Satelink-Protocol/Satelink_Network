# ORCHESTRATOR TASK — SLOT 6
Status: WAITING
Model: Claude Sonnet 4.6 (temporary)
Max Turns: 8

## JOB
Review this week. Write next week's queue.

## EXACT STEPS
1. Read agent/memory/PROGRESS.md — collect all DONE entries
2. Write agent/memory/MASTER_PROGRESS.md:

# MASTER PROGRESS — [date]
## This Week Completed
[list all DONE entries with slot, task, outcome]

## Completion Rate
[X/6 slots completed]

## Issues Found
[any blockers or failures noted]

## Next Week Priority
[top 3 tasks based on what's still missing]

3. Update MASTER_TASK_QUEUE.md — write next cycle's slot 1-6 based on what remains
4. Write to agent/memory/PROGRESS.md:
   DONE | slot=6 | task=week_review | next_queue=updated | timestamp=$(date)
5. STOP.

## EXIT CONDITION
MASTER_PROGRESS.md written. MASTER_TASK_QUEUE.md updated. DONE written. STOP.
