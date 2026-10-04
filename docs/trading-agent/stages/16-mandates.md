# Stage 16 — User-signed mandates

**Branch:** `trading-agent/stage-16-mandates`, stacked on Stage 15 (#471).

**Principle:** *every live action traces to a user-signed mandate.* A mandate is a canonical, hashed terms document. The owner signs it with step-up authentication, for exactly one hash and one nonce. It can expire, be revoked, be superseded by a new version, or be shut down in an emergency. The Stage 15 risk engine trusts only `MandateService.verifyForOrder()`.

**Code:** `apps/api/src/trading_agent/authorization/` (module table in its `README.md`).

**DB:** additive migration `026_mandates.sql`. Its down file is `database/migrations-down/026_mandates.down.sql` (local/ephemeral only).

**API:** internal only. Nothing is mounted, and no login flow is changed.

## Inspection and STOP evaluation

> STOP if: no step-up auth exists (propose passkey/OTP addition; founder approval).

**Not triggered: a usable step-up factor exists.** From audit 06 (§1, S-11), re-checked against the code:

| Factor | State | Evidence |
|---|---|---|
| **TOTP 2FA** | **present**, optional per user (enabled from console Settings) | Better Auth `twoFactor()` plugin, `apps/api/src/auth/better_auth.mjs` (better-auth 1.7.5) |
| Passkeys / WebAuthn | **absent** | audit 06: 0 hits in product code |
| Required step-up anywhere | **none today** | audit 06: no `freshAge` / `stepUp` / `requireTwoFactor`; every sensitive action runs on a plain session |

**How TOTP is reused without changing login.** I read better-auth's `two-factor/totp` and `verify-two-factor` sources. For a caller with an **existing session**, `auth.api.verifyTOTP({headers, body:{code}})` only verifies the code. It creates a session and sets cookies only on the *sign-in* path, which has a two-factor cookie and no session.

Two hazards were found and are closed in the adapter (`step_up.mjs`):
1. **Enrolment side effect:** if 2FA is not yet enrolled, `verifyTOTP` *completes enrolment* and rotates the session. The adapter refuses unless `session.user.twoFactorEnabled === true`, so this branch is never reached (tested: `verifyTOTP` is not called).
2. **No lockout or reuse tracking on the signed-in path:** better-auth's lockout only applies to sign-in. `MandateService` therefore adds:
   - **5 attempts per proposal**, after which the proposal is voided;
   - **refusal of a reused code** for 120 s, using a keyed fingerprint (`audit_events`; the code itself is never stored).

The adapter uses exactly two Better Auth APIs (`getSession`, `verifyTOTP`); a test proxy proves nothing else is touched. It reaches Better Auth only through an injected getter, so `authorization/**` imports no auth or session module (static test).

**Proposal (not done; founder decision):** require TOTP enrolment before a user can sign any mandate (enforced here as `STEP_UP_UNAVAILABLE`), and add **passkeys (WebAuthn)** as the preferred factor (audit 06 S-11). A passkey would make the signature *user-held* rather than a server attestation (see Signatures).

**"Document A" (modes A/B/C) is still not in the repo** (the Downloads PDFs are the March 2026 RPC architecture plan). The modes below are a documented substitute.

## Modes

| Mode | Meaning | 021 `mode` | Gate |
|---|---|---|---|
| **A** | copilot: every order needs the owner's per-order approval | `copilot` | risk check 7 requires `approvedBy = owner` |
| **B** | a bound, lifecycle-approved **deterministic strategy** executes within the terms without per-order approval | `automated` | the terms must bind a stored strategy version (id + definition hash) |
| **C** | autonomous: agent-originated orders without per-order approval | `automated` | **refused** at propose, sign and verify while `AUTONOMOUS_MODE` is LOCKED (even with the env flag set) |

**Open decision for the founder:** Stage 15 check 3 requires `AUTONOMOUS_MODE` for **any** order without a human approver, so mode B orders are also blocked today. If B (deterministic strategy, no LLM) should be usable before C, it needs its own flag, which means a reviewed change to check 3. I have not changed Stage 15.

## Lifecycle

```
propose ──► draft ──sign (step-up)──► active ──revoke──────► revoked
              │                          ├──validUntil─────► expired
              ├──revoke / 5 failed codes─┘──superseded─────► revoked (reason superseded_by:<id>)
```

1. **propose:**
   - The owner submits a draft (account, environment, mode, strategy binding, instruments, limits, window).
   - The server checks the draft: the account belongs to the owner, is active and matches the environment, and the strategy binding matches the stored version. It then adds the lineage, version, venue, principal and a fresh 128-bit **nonce**.
   - The terms are validated (unknown fields rejected, at most 90 days, `validFrom` not in the past, daily limit ≥ order limit) and canonically hashed (RFC 8785 + sha256, as in Stage 13). The nonce is part of the hash.
   - The response returns `{mandateId, termsHash, nonce, challenge, challengeExpiresAt (10 min)}`.
2. **sign:** the owner echoes `termsHash` and `nonce` with a step-up code. Checks, in order:
   1. ownership;
   2. **replay:** not already signed or voided, and the nonce matches;
   3. challenge expiry;
   4. **hash:** the echoed hash equals the stored one, and the stored terms still hash to it;
   5. attempt cap;
   6. mode lock;
   7. factor enrolled;
   8. **code reuse;**
   9. step-up verify.

   A failed attempt is persisted (the outcome is decided in the transaction, and the error is thrown after commit). On success the mandate becomes `active` with a signature. If it supersedes a version, that version is revoked and its open orders cancelled **in the same transaction**. Only one active version per lineage is enforced by the DB.
3. **verifyForOrder** (what risk check 7 consumes). Checks, in order:
   1. terms integrity (re-hash);
   2. the row matches its signed terms (account, strategy, mode, limits, currency, window, environment);
   3. state (revoked / expired / not active);
   4. **signature verifies** (constant-time; key id must match);
   5. validity window;
   6. mode lock.

   It returns the Stage 15 `ctx.mandate` shape. A test proves a verified mandate passes check 7, and that mode A still needs per-order approval.
4. **revoke** (owner, admin or platform; never an agent): sets `revoked` + reason. **Future orders are cancelled:**
   - unsent `proposed` / `approved` orders → `cancelled`;
   - orders already at a broker (`submitted` / `acknowledged` / `partially_filled`) → `cancel_requested`, for the execution stage to send;
   - an `order_events` row is written for each.
5. **expireDue:** idempotent. Active mandates past `validUntil` become `expired`, with the same order handling. `verifyForOrder` refuses an expired mandate even before the job runs.
6. **emergencyShutdown:**
   - for a principal (owner, admin or platform): **engage the principal kill switch first** (Stage 15 `KillSwitchService`), then revoke every active and draft mandate and cancel their orders;
   - **global:** admin only; engages the global kill switch.

   After a shutdown, risk check 1 stops every order (tested).

**Audit:** `mandate.proposed`, `.signed`, `.sign_failed`, `.superseded`, `.revoked`, `.expired` and `.emergency_shutdown`, each with actor type, actor id, hashes and order counts.

## Signatures and replay

- **Signature:** `hmac-sha256:` over **canonical JSON** of `{v, mandateId, termsHash, nonce, signer, method, signedAt, keyId}`, with an injected key (≥ 32 bytes, rotated by `keyId`).
- **What it proves, stated plainly:** with TOTP, the user holds no key, so this is a **server attestation**: the authenticated owner passed step-up for exactly this hash and nonce. In production the key must live in a KMS (B-08). With passkeys it would become a user-held-key signature over the same challenge.
- **Replay defences:**
  - a one-time **nonce** inside the hash;
  - a signing request is valid only once (state);
  - a 10-minute challenge expiry;
  - step-up codes refused if reused within 120 s;
  - an attempt cap of 5.

## Migration 026 (additive to 021 `mandates`)

- **New nullable columns:** `mode_code`, `lineage_id`, `version`, `supersedes_id`, `environment`, `terms`, `terms_hash`, `sign_nonce`, `sign_nonce_expires_at`, `sign_attempts`, `signature`, `signature_key_id`, `signed_at`, `revocation_reason`.
- **CHECKs:** mode A ⇔ `copilot`; a signed document is complete; active ⇒ signed; revoked ⇒ timestamp + reason.
- **Uniqueness:** `(lineage_id, version)`; **one active per lineage**.
- **Trigger `mandates_guard`**, for rows with `terms_hash`:
  - signed terms and identifying columns are immutable;
  - transitions are only draft → draft / active / revoked and active → revoked / expired;
  - the signature is fixed once signed;
  - final states are frozen.
- **DELETE is blocked** for all rows.
- Rows created before Stage 16 (none exist) keep their old update behaviour.
- **Rollback order:** 026 alters a 021 table, so the 021 round trip now rolls back `026 → 025 → 024 → 021`.

## Blocker impact

| Blocker | Touched? | Why the stage stays inside the accepted isolation |
|---|---|---|
| B-06 (no staging) | yes (migration 026) | applied only to local ephemeral Postgres; nothing deployed |
| B-07 (migration tooling) | yes | additive 026 via the canonical runner; rollback order documented |
| B-02 (staff auth) | **constrains** | admin revoke and global shutdown use a caller-asserted role; they must not be exposed until staff auth exists |
| B-08 (KMS) | **constrains** | the attestation key is injected. Production needs a KMS-held key before any live mandate is signed |
| B-09 (scope) | no | modes are authority records only; nothing executes |
| Audit 06 S-11 (no step-up) | **partially addressed** | mandates now *require* TOTP step-up. Passkeys and step-up for other sensitive actions remain open |
| B-01, B-03, B-04, B-05, B-10, B-11 | no | not mounted; no login, CI or infra change |

No blocker changes status. The Stage 16 row is added to the acceptance log in `docs/trading-agent/BLOCKERS.md`.

## Test evidence (2026-10-04)

| Suite | Result |
|---|---|
| `apps/api/test/trading_mandates.test.js` (mocha) | **17 passing** |
| Integration, local Postgres 16 (guard-DB recipe): `trading-mandates` (5 new) + risk + backtests + strategy DSL + agent traces + market data + foundation (021 round trip rolls back 026 → 025 → 024) | **26 passing**; temporary DBs dropped, none left behind |
| `scripts/ci-baseline-check.sh` | clean run: **718 tests / 598 pass / 2 known failures / 118 pending** (+17/+17 vs Stage 15) |

**Baseline flakiness, reported honestly:** another full run failed rate-limit timing tests: `identity_rate_limit` (known since Stage 12) and `api_keys` P0-2 `apiKeyCreateLimiter`. Both sort before the `trading_*` files, so they run before any Stage 16 code is loaded. They are not fixed here (out of scope).

### Brief acceptance mapping (§11)

- **Expired:** refused by `verifyForOrder` past `validUntil`, even before the job runs. `expireDue` expires the mandate, is idempotent and cancels orders; an expired mandate can't be revoked. An unsigned challenge expires after 10 minutes. A future `validFrom` gives `NOT_YET_VALID`.
- **Revoked:** `verifyForOrder` gives `REVOKED`. All 8 order statuses are handled correctly (2 cancelled, 3 cancel-requested, terminal ones untouched, another mandate's orders untouched), with `order_events`. A double revoke is a `CONFLICT`.
- **Hash mismatch:** these all reject:
  - a signature over a different hash;
  - stored terms tampered at rest (refused **before** step-up is asked);
  - a row drifting from its signed terms;
  - a forged signature;
  - the wrong signing key.
- **Replay:** these all reject:
  - an exact replay of a successful sign request;
  - a wrong nonce, or the nonce of another proposal;
  - the same TOTP code on a second mandate (refused **before** verification);
  - a code reused within 120 s (accepted after).
- **Also covered:**
  - the attempt cap (4 persisted failures, the 5th voids the proposal);
  - no enrolled factor (no attempt spent);
  - the adapter: own session only, never before enrolment, only two auth APIs touched;
  - mode C locked even with the env flag; mode B binding checks;
  - 10 malformed or unsafe drafts;
  - the permission matrix (agents, admins and other users);
  - versioning (v1 active until v2 is signed, then superseded with orders cancelled; only active mandates can be superseded);
  - emergency shutdown (kill switch first, then revoke all; risk check 1 then stops orders; global is admin only);
  - static isolation.
- **Postgres:**
  - the JSONB round trip keeps the hash and signature valid;
  - code reuse is detected through `audit_events`;
  - every trigger rule holds (immutable terms, illegal transitions, signature fixed, final states frozen, no delete, reason required);
  - one active version per lineage;
  - supersession cancels real orders with `order_events`;
  - `expireDue`;
  - the down migration.
- **Mutation checks** (each change temporarily applied, then reverted). Every one made the suite fail:
  - hash not compared;
  - nonce not checked;
  - code reuse allowed;
  - expiry not enforced;
  - revoked accepted;
  - signature not verified;
  - adapter verifying before enrolment;
  - approved orders surviving revocation;
  - mode C allowed.

## Follow-ups (not in this stage)

- **Wiring:** HTTP routes (behind staff auth for admin actions, B-02), a `principal ↔ Better Auth user` mapping for `authUserIdOf`, a scheduler for `expireDue`, and a KMS-held signing key (B-08).
- **Passkeys (WebAuthn)** as the preferred factor; make TOTP enrolment a prerequisite in the UI.
- **Founder decision:** a separate flag for mode B, so check 3 doesn't treat a deterministic strategy like an autonomous agent.
- **Execution stage:** send the broker cancels for `cancel_requested` orders.
- **Reconcile modes and terms with Document A** if it is found (new `satelink.mandate/x` version).

## Rollback

Revert the commit. On a local database, apply `026_mandates.down.sql` (before 025 / 024 / 021 downs).
