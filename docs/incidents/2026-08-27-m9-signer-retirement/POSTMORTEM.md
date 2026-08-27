# M9 endurance run — post-mortem & signer retirement (2026-08-27)

## Summary
The M9 multi-nonce endurance driver (the ship-gate test: a fresh non-founder wallet signs
5 nonces once, makes 5000+ calls over 3+ days) **died at call 64 of ~5000 on
2026-08-21T08:33:06Z** and produced no further records. Nobody noticed for **6 days**. Its
test signer `0x2821…2006` still holds 5 active, unexpired authorizations; they are being
revoked via the new `tools/ops/revoke-authorization.ts` and the Keychain key retired.

## The important question is NOT why the driver died
The evidence file (`m9_exit_gate_evidence.jsonl`, 64 records) ends cleanly mid-run at call 64.
Whatever killed the process (crash, OOM, terminal closed, laptop sleep) is secondary. The
real failure is a **missing operational control**:

> A detached process that writes to the production money path ran, died, and left the
> system in a partial state for 6 days with **no alert**. The only reason we know is a
> manual read of the evidence file during an unrelated incident.

### The missing control (name it)
There is **no liveness alert on the evidence JSONL**. A detached prod-writing driver must
have a heartbeat: if its evidence file stops advancing for > 15 minutes while the run is
marked active, something must page. That control belongs in **`workers/reconciler`** and is
still **unbuilt** (it was scoped as a Phase-2 guardrail in the 2026-08-27 volume-exhaustion
work and deferred). Until it exists, any long-running driver can die silently again.

### Secondary: the driver's own missing exit condition
The driver had no self-terminating exit gate that writes a terminal record on completion OR
failure. A re-run must:
1. Write a final `{"event":"run_complete"|"run_failed", ...}` record on ANY exit path
   (success, error, signal) — so the absence of a terminal record is itself detectable.
2. Emit a heartbeat record (or touch a heartbeat file) on a fixed interval independent of
   call cadence, so a stalled run is distinguishable from a slow one.
3. Bound total runtime and call count so it cannot hang past its exit gate.

**M9 is NOT being re-run.** The ship gate is deferred until there is a second real external
payer (per the standing decision). This post-mortem exists so the re-run, when it happens,
cannot fail silently.

## Impact
- No customer impact: M9 used a dedicated test signer, not a customer wallet.
  `SETTLEMENT_DRY_RUN=1` throughout — nothing settled on-chain.
- 5 authorizations for `0x2821…` sat `active` and unexpired (until 2026-09-19) for 6 days.
  One (`auth_b800…`) had `consumed_amount=2010` from request-path metering; the other four 0.
  No draws reference any of them (the `draws` table is empty), so nothing was left
  half-settled — but the capability to draw remained open, which is why they are being
  revoked rather than left to auto-expire.

## Corrective actions
| # | action | status |
|---|---|---|
| 1 | Build the authorization-revocation path (`tools/ops/revoke-authorization.ts`) | **done** (this PR) |
| 2 | Revoke the 5 `0x2821…` authorizations via that script | pending founder approval (STOP-1) |
| 3 | Retire the Keychain signer | pending (STOP-2, after #2 + evidence committed) |
| 4 | Liveness alert on driver evidence files in `workers/reconciler` | **not built** — the load-bearing control; do not re-run any driver until it exists |
| 5 | Driver terminal-record + heartbeat + runtime bound | spec above; apply before any M9 re-run |

## Evidence archived here
- `m9_exit_gate_evidence.jsonl` — 64 records, last `2026-08-21T08:33:06Z` (call 64).
- `m9_resume_note.txt` — the operator resume note captured at retirement.
