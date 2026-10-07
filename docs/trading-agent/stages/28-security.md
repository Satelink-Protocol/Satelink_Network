# Stage 28 — Security hardening (option 1: everything except a cloud KMS)

**Decision (founder order, 2026-10-07):** Stage 28 option 1. Build the envelope-encryption interface with a local provider and an AWS KMS provider (written, OFF), a separate DB role for credential decryption, a static-egress declaration, non-breaking CI secret + licence scans, a daily Binance key re-check, and admin step-up. **Gate 7 is recorded NOT PASSED** pending the KMS account.

## Inspection (reuse before build)

| Existing | Where | Used how |
|---|---|---|
| credential tables (no plaintext; `wrapped_dek`, `iv`, `auth_tag`, `ciphertext`; `kms_key_ref`) | migration 021 | the envelope output maps 1:1 onto them — no schema change |
| AES-GCM + AAD-bound envelopes, injected keyring | `brokers/upstox/token_vault.mjs` (Stage 22) | same technique, generalised to a KeyProvider with per-secret DEKs |
| `satelink_app` role + default privileges | migration 017 | 031 narrows them for the ciphertext table only |
| Binance `apiRestrictions` rules | `brokers/binance/key_validation.mjs` (Stage 21) | the daily re-check calls `evaluateApiRestrictions` unchanged |
| kill switches (SYSTEM source, broker_account scope) | `risk/kill_switch_service.mjs` (Stage 15) | the re-check engages through it |
| step-up verifier (Better Auth TOTP) | `authorization/step_up.mjs` (Stage 16) | admin step-up composes it with a staff check + audit |
| CI secret scan (3 prefixes, blocking) | `.github/workflows/ci.yml` | left as is; the new trading scan is broader and report-only |

No new npm dependency (the KMS provider signs SigV4 itself).

## Design

- **Envelope encryption** (`security/envelope.mjs`): fresh 256-bit DEK per secret, AES-256-GCM; the encryption context (credential, broker account, principal) is bound as the provider's wrap context and as the GCM AAD. DEKs are zeroed after use.
- **Providers**: `LocalDevKeyProvider` (master key injected); `AwsKmsKeyProvider` (GenerateDataKey / Decrypt with `EncryptionContext`). `keyProviderFromConfig` fails closed: nothing configured → `NOT_CONFIGURED`; local in production → `REFUSED` unless `TRADING_LOCAL_KEY_PROVIDER_ACCEPTED=capped-beta` (founder); AWS → `REFUSED` unless `TRADING_AWS_KMS_ENABLED=true`.
- **DB role** (migration `031_trading_credential_roles.sql`, additive): `trading_credential_decryptor` (NOLOGIN) is the only non-superuser role that can SELECT `broker_credential_ciphertexts` (plus 5 non-secret metadata columns, found necessary by the integration test); `satelink_app` keeps INSERT only. Membership is an ops action, never a migration.
- **Static egress** (`security/egress.mjs`): `TRADING_EXECUTION_EGRESS_IP` + `TRADING_EXECUTION_REGION`, validated (public IPv4; US/CA regions refused). `assertEgressReady()` is what a real adapter must call. Status today: **NOT_PROVISIONED**.
- **CI scans**: `scripts/trading/security-scan.mjs` (secret patterns by name — never the value; production-dependency licences, dual-licence aware) + `.github/workflows/trading-security-scans.yml` (`continue-on-error`, report-only). First run on integration: 1 secret finding (a deliberate fake live-key fixture in `trading_billing.test.js`), 11 licence findings — notably **`ua-parser-js` AGPL** (removed on `main` by #493 with RainbowKit), `@dodopayments/nextjs` and `format` with no licence field, and the `@next/swc-*` binaries (no licence field).
- **Daily key re-check** (`security/key_recheck.mjs`): any violation or failed check → SYSTEM kill switch on that broker account + alert. Releasing it is the admin action `broker_key.recheck_override`.
- **Admin step-up** (`security/admin_step_up.mjs`): 7 admin actions; staff check (injected, server-side) + fresh TOTP; codes single-use per action; every attempt audited; Express middleware with 403 / 401.

## Test evidence (2026-10-07)

| Suite | Result |
|---|---|
| `apps/api/test/trading_security.test.js` | **33 passing**: envelope round trip; 7 decrypt refusals (other credential, other principal, tampered ciphertext / DEK / tag, other key ref, other master key); bad config; AWS provider with a fake KMS (SigV4 header shape, no secret in headers, EncryptionContext sent, round trip, wrong context → DECRYPT_FAILED, deterministic signature, network / 5xx → PROVIDER_UNAVAILABLE); factory fail-closed rules; providers never read env/fs; egress (unset, private, malformed, US, no region, valid); admin step-up (non-staff, no code, wrong code, success, replay, unknown action, middleware 403/401/next); key re-check (widened key + failed call → 2 SYSTEM switches + alerts); scan rules; workflow non-breaking; not mounted |
| `database/__tests__/trading-security.integration.test.ts` (local Postgres, guard-DB recipe) | **5 passing**: role NOLOGIN / not superuser; `satelink_app` can INSERT but SELECT/UPDATE → permission denied; a PUBLIC-only role → denied; **only the decryptor can read and decrypt** (grantee list = decryptor only); down migration restores 017 grants |
| All trading integration suites | **13 files, 52 passing** (031 added to the foundation down-chain and the migrations file list) |
| Mutation checks (10) | all caught: context not bound, key ref unchecked, local allowed in prod, AWS not gated, US region allowed, staff check removed, code replay allowed, failed re-check treated as ok, Decrypt without EncryptionContext, **app role granted SELECT in 031** (caught by the Postgres test) |

## Gate 7 — NOT PASSED

| Gate 7 item (Stage 31 G1-03) | State |
|---|---|
| KMS | **missing** — AWS provider written, OFF; no KMS account (founder) |
| DB roles | **done in code** (031); membership grant + `DATABASE_URL` → `satelink_app` are founder/ops actions |
| static egress | **declared only** — no execution service / static IP provisioned (founder) |
| CI scans | **done**, report-only |
| daily key check | **done** (one run); scheduled by the bot runner (Phase 6 item 10) |
| admin step-up | **done**, unmounted |
| rotated secrets | **pending** — `SECURITY_HOTFIX.md` founder actions |

## Blocker impact

| Blocker | Touched? | Why the stage stays inside the accepted isolation |
|---|---|---|
| B-08 (KMS / signer / egress) | yes, **not resolved** | KMS provider OFF; egress declared, not provisioned; B-08 stays OPEN |
| B-07 (roles) | yes | 031 is additive grants only; applied only to local ephemeral databases |
| B-06 (no staging) | yes | migration 031 not applied to any shared database |
| B-03 / B-10 | no | nothing mounted; the new workflow is non-blocking |
| B-11 (licence) | informs | the licence scan reports AGPL `ua-parser-js` (removed on `main` by #493) — the repo-licence decision stays the founder's |
