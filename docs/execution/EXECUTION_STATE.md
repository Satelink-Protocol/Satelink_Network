# EXECUTION_STATE

Updated: 2026-09-28 ~06:20 IST · Contract: `~/satelink-prompts/SATELINK_MASTER_EXECUTION.md` v2
Current wave: **1 (signed-in verification) + 2 (exit met for discovery) + 3 (D5)** · Completion **6 / 89 PROD-VERIFIED**.

## Deployed SHA
| Surface | Serving | Evidence |
|---|---|---|
| Railway `Satelink-api` | **60e1eef** (#452) SUCCESS | `railway deployment list`; health 200; live consistency 15/15 |
| Vercel `web` | main @ 60e1eef | satelink.network JSON-LD shows the new copy |
| Vercel `satelink-console` | main | — (signed-in pass pending) |

## Done this session (2026-09-28)
- Founder decisions D-1..D-5 recorded (#451 merged 0187b45).
- D-2 pack bonuses → **#447** · D-4 JSON-RPC errors 200 + charged → **#448** · Task 2 TEST-mode checkout allowlist →
  **#449** · B8 deps → **#450** · D5 request log + D7 error rate + /requests V2 → **#453** (all: founder merge).
- Wave 2: catalog single source + CI consistency test → **#452 merged 60e1eef**, deployed, **15/15 in production**;
  fixed two live drifts (web JSON-LD "500-calls/day free tier"; `/api/pricing` per-method prices nobody is charged).
- Task 4: revenue_events_v2 writes NOT stopped in code (proof row 2734806); double-count → FG-REV-RECOGNITION.
- Task 5: `docs/legal/MARKET_DATA_TERMS.md` (OKX §9.4 expressly prohibits our use; FG-TI-LEGAL) + region plan (blocked on counsel).
- Task 6: triage doc; all 3 funded exposed keys are founder-owned; redaction dry-run 0 rows.

## Blocked / waiting
- **Task 1 signed-in pass**: headed browser open at console sign-in (profile `~/satelink-private/pw-profile`); founder
  must sign in and say "signed in". Script prepared (routes × Simple/Advanced, V1 text scan, screenshots).
- **GATE-BACKFILL-KEY132**: approved + condition met; prod write blocked by this session's permission classifier → founder runs.
- **FG-ADMIN-TOKEN-ROTATE** (new P1): ADMIN_SECRET_TOKEN value reached this session's transcript.
- `DATABASE_URL` (prod) is still inherited by this session's parent process (zshrc no longer exports it) → every
  command runs with `env -u DATABASE_URL`; restart Claude Code from a clean shell to clear it.

## Next 3 actions
1. On "signed in": run the signed-in pass, then one safe mutation per page; mark D-rows PROD-VERIFIED with screenshots.
2. After #453 merges: apply migration 020 (snapshot first), prove one founder call → request_log row → /requests.
3. D6 per-product meters (Usage page) on top of request_log; then D3/D4, D10, D12.
