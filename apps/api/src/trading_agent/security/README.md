# trading_agent/security — Stage 28, option 1 (no cloud KMS)

| File | What | State |
|---|---|---|
| `envelope.mjs` | AES-256-GCM envelope encryption for broker credentials; rows map onto `broker_credential_ciphertexts` (021); context bound as KMS context **and** GCM AAD | ready |
| `providers/local_dev.mjs` | local key provider (master key injected; not a KMS) | dev/tests; prod only with founder "capped-beta" acceptance |
| `providers/aws_kms.mjs` | AWS KMS provider (GenerateDataKey / Decrypt, SigV4, no SDK) | **written, OFF** (`TRADING_AWS_KMS_ENABLED`) |
| `provider_factory.mjs` | picks the provider from config; default = none → fail closed | ready |
| `egress.mjs` | static egress IP + region declaration and validation (US/CA regions refused) | declared only; nothing provisioned |
| `admin_step_up.mjs` | staff-only actions need a server-verified staff principal + fresh single-use TOTP; every attempt audited | ready, unmounted |
| `key_recheck.mjs` | daily Binance `apiRestrictions` re-check → SYSTEM kill switch on the broker account + alert | one run; the bot runner schedules it |
| migration `031_trading_credential_roles.sql` | `trading_credential_decryptor` is the only non-superuser role that can read ciphertexts; `satelink_app` INSERT-only | local DBs only |
| `scripts/trading/security-scan.mjs` + `.github/workflows/trading-security-scans.yml` | secret patterns + production-dependency licences | report-only (non-breaking) |

**Gate 7 is NOT PASSED** until a KMS account exists and the execution service runs with a static non-US egress IP (founder actions, `docs/trading-agent/GO_LIVE_FOUNDER_CHECKLIST.md`).
