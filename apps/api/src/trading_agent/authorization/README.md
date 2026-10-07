# trading_agent/authorization

**Status:** Stage 16 user-signed mandates. `STATUS = 'skeleton'` = not wired: no routes, not mounted, nothing schedules `expireDue()`.

**Responsibility:** every live action traces to a mandate the owning user signed with step-up authentication. Mandates are the only source of trading authority for the Stage 15 risk engine (check 7).

**Table:** `mandates` (021 + 026 columns: terms, hash, nonce, signature, lineage / version, mode code), plus `audit_events` (`mandate.*`) and `orders` / `order_events` (revocation cancels).

| Module | Purpose |
|---|---|
| `terms.mjs` | mandate terms v1 schema; modes A / B / C; validate + normalise + canonical hash (the nonce is inside the hash) |
| `signing.mjs` | signing challenge; HMAC-SHA256 attestation over canonical JSON (injected key id + secret; KMS in production); constant-time verify; step-up code fingerprint |
| `step_up.mjs` | step-up contract plus the **Better Auth TOTP adapter**. Uses only `getSession` and `verifyTOTP` on an existing 2FA-enabled session, so it never signs in, never enrols and sets no cookies |
| `service.mjs` | `MandateService`: propose, sign, revoke, emergencyShutdown, expireDue, verifyForOrder |
| `store.mjs` | `InMemoryMandateStore`, `PgMandateStore` (advisory-locked transactions, order cancellation with `order_events`) |

**Who may do what:**

| Action | Allowed |
|---|---|
| propose / sign | the owning human user only (not admins, not agents) |
| revoke | the owner, an admin, or the platform |
| emergency shutdown | the owner, an admin, or the platform for one principal; admin only for global |
| any of the above by an agent | **never** |

The Stage 09 `mandates/` skeleton is intentionally untouched (the brief scopes Stage 16 to `trading/authorization/**`).
