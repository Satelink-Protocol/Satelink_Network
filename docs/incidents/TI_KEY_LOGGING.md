# Incident — full API keys written outside the key columns

_Opened 2026-09-25 · severity: high (secret exposure, internal) · fix: `fix/ti-api-key-logging`_

## What happened
API keys (`api_credits.api_key`) are bearer secrets. Several code paths copied the **full** key into
places that are not the identifier columns:

| Where | Mechanism | Stored / sent in production (read-only check 2026-09-25) |
|---|---|---|
| `revenue_events_v2.request_id` (Trading Intelligence) | `intel:<metric>:<FULL KEY>:<ts>`; also copied into Redis dedup keys and shadow-ledger ids | **0 rows** — TI has never served a snapshot in prod, so no TI revenue row exists |
| `machine_crm_snapshots.machines` (hourly admin CRM snapshot) | `machine_id` = the full key | **1,324 rows, 52 distinct keys**, since 2026-07-16 |
| `principals.external_ref` (Financial OS identity link) | the full key as the external reference | 3 rows (a subset of the 52) |
| Discord alerts (`internal_dodo` refund shortfall / dispute expired) | key in the alert text | **0** events of those kinds → nothing sent |
| Redis key names (`rpc:apikey:*`, `rpc:usage:*`, `sdk:usage:*`, `mev:*`) | the key as part of the cache key name | live cache only (not persisted in Postgres) |
| Logs (`credit_system`, `api_keys_route`, `rate_limiter`) | 10–15-character prefixes (never the full key) | partial prefixes only |

Exposure was **internal**: the rows are readable by anyone with database or admin-analytics access,
and Redis names by anyone with Redis access. No evidence of external disclosure.

## Exposed keys (fingerprints only — `prefix…last4`)
52 distinct keys, 51 still `active`. **3 hold a balance ($25.578370 in total) and were used in the last
30 days — rotate these first:** `sk_live_…135a`, `sk_free_…5677`, `sk_dodo_…46a5`.

All 52: sk_dodo_…102a, sk_dodo_…46a5, sk_free_…b1ff, sk_free_…3493, sk_free_…7490, sk_free_…2e84,
sk_free_…282f, sk_free_…c401, sk_free_…84a2, sk_free_…48ed, sk_free_…58e0, sk_free_…588e, sk_free_…4230,
sk_free_…715d, sk_free_…da59, sk_free_…6c6b, sk_free_…e7ea, sk_free_…d3ac, sk_free_…3c1f, sk_free_…cda1,
sk_free_…5677, sk_free_…0463, sk_free_…4b4d, sk_free_…1075, sk_free_…0776, sk_free_…6309, sk_free_…09b3,
sk_free_…4716, sk_free_…8b7a, sk_free_…805a, sk_free_…d3de, sk_free_…159a, sk_free_…03e2, sk_free_…f91c,
sk_free_…9ff6, sk_free_…e90f, sk_free_…2453, sk_free_…f7da, sk_free_…58b3, sk_free_…5cf6, sk_free_…8dda,
sk_free_…d396, sk_free_…1061, sk_free_…336b, sk_free_…dedf, sk_free_…5fc2, sk_free_…68a1, sk_free_…a529,
sk_free_…5b6e, sk_free_…03d1, sk_free_…eebb, sk_live_…135a

## Fix (this PR)
- `src/security/key_mask.mjs`: `keyHint` (display: `sk_free_…9f3a`), `keyRef` (non-reversible
  SHA-256 reference for ids), `redactKeys` (free text).
- TI `request_id` → `intel:<metric>:kref_<16 hex>:<ts>:<nonce>`; the shared revenue writer
  (`recordRpcRevenue`) rewrites any id that still carries the key.
- CRM report: `machine_id = keyRef(key)` + `machine_hint`; snapshot JSON passes through `redactKeys`.
- Discord alert texts and logs use `keyHint`; Redis names use `keyRef` (key-info entries migrate
  from the old name on first read; daily usage counters restart under the new name).
- Tests (`test/key_masking.test.js`): helpers; **static scan of all of `src/`** — any unmasked
  `${apiKey}` interpolation fails CI (only allowed: sending the key as a credential, and the
  one-time creation response to its owner); TI stores no key; the revenue writer guard.

## Redaction of stored data (founder runs, after review)
`apps/api/scripts/incidents/redact_exposed_keys.mjs` — dry-run by default, `--apply` in one
transaction, idempotent. Dry run today: TI request ids **0**, CRM snapshots **1,324 rows**.
```
railway run --service Satelink-api -- node apps/api/scripts/incidents/redact_exposed_keys.mjs          # dry run
railway run --service Satelink-api -- node apps/api/scripts/incidents/redact_exposed_keys.mjs --apply  # redact
```

## Recommendations
1. **Rotate** the 3 funded keys now; offer rotation to the other 48 active ones (the console Rotate
   action from #425 moves the balance, once `CONSOLE_ACCOUNTS_V1` is on — or rotate manually).
2. Run the redaction script after this PR deploys (so no new snapshot re-adds keys).
3. `principals.external_ref`: switch the Financial OS link to `api_credits.id` or `keyRef(key)` —
   a Financial OS schema decision, not changed here.
4. Flush Redis `rpc:apikey:sk_*` / `sdk:usage:sk_*` / `mev:*:sk_*` names after deploy (or let them
   expire).
