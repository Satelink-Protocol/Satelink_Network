# M9 signer 0x2821… — revocation executed 2026-08-27

Ran `tools/ops/revoke-authorization.ts --signer 0x2821… --confirm` against production
(`railway run --service Postgres-iQeW`). Reason: "M9 endurance test terminated at call
64/5000; signer retirement 2026-08-27". Actor: sre-2026-08-27.

## Result — 5 revoked
```
[revoke-authorization] target=PRODUCTION mode=CONFIRM (mutating)
DONE: 5 to-revoke, 0 already-revoked, 0 not-found
```
Audit lines (one per authorization, key material never logged):
```
auth_b800bf9f43c25e03b89dd1c880778de401d5db00  consumed=2010  active->revoked
auth_c362fa1673b7390b7f3e16850f704ea071611d5e  consumed=0     active->revoked
auth_c45b1fcb72c8327a01794770071d6c96835fa535  consumed=0     active->revoked
auth_da9cc72159c9ad8187cdaa9baafa0548c838a042  consumed=0     active->revoked
auth_fd49d5278ec833800342f6013f3687011cf4b0d2  consumed=0     active->revoked
```

## Verification (psql / curl — CLI claims are not evidence)
- **state:** 5 rows `state=revoked`, `version=2`; **0 active-unexpired** for the signer.
- **consumed_amount preserved:** `auth_b800…` still `2010` — revocation did NOT rewrite history.
- **ledger_entries unchanged:** 691,306 rows / sum 891,304 before AND after (append-only intact).
- **real revenue unchanged:** 2 rows / $0.20 (`is_test_data=false`).
- **behavioral (`authorization_revoked`):** a `POST /rpc/base` with `x-wallet-address: 0x2821…`
  returns HTTP **402** `{"ok":false,"error":"authorization_revoked","message":"Your capacity
  authorization has been revoked. This identity cannot draw capacity."}` — the distinct code
  (PR #333), not a generic denial. Enforcement mode is `new`.

## Note (execution)
The `--confirm` run initially failed with `ERR_MODULE_NOT_FOUND` because the working tree was
on `main` (the script lives on `feat/authorization-revocation-ops`). No mutation occurred (the
failure was at module resolution, before any code ran — verified: all 5 still `active/version=1`
at that point). Re-ran on the branch; succeeded.

## Next: STOP-2 (operator)
All 3 preconditions now hold — see POSTMORTEM.md. Keychain deletion command is printed for the
operator; it was NOT run by the agent.
