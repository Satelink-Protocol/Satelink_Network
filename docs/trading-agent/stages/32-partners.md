# Stage 32 — Partner validation

**Human approval is required. No partner state changed.** No partner evidence was provided for this stage, so every broker stays **UNVERIFIED**, every item stays NO_EVIDENCE and no Link ID was configured. The STOP condition (evidence is verbal only) was not triggered, because there is no evidence of any kind. **The founder supplies the documents; nothing moves without them.**

PR: #TBD (draft, stacked on #485)

## Inspection

- **No partner tracker existed.** Nothing in `docs/trading-agent/`, the audits 00–08 (local branches) or the app's partner code (`partner_portal.js` and the like are the unrelated RPC partner programme).
- **The Link ID was a bare constructor argument.** Stage 21's `BinanceSpotAdapter` takes `linkId` directly, validates it with `LINK_ID_RE` (4–16 alphanumerics) and adds `x-`. Nothing loaded it from configuration.
- **The broker state machine** (`apps/web/src/lib/trading-agent/status.ts`) tracks code state only. All three brokers are `tested`; it is unchanged.
- **Secret store:** none exists beyond the hosting environment (KMS is Stage 28, paused). The Link ID is read through an injected `secrets.get(name)` interface, so either backend fits.

## What was built

| Piece | Path |
|---|---|
| Tracker data (all UNVERIFIED) | `docs/trading-agent/partners/partners.json` |
| Tracker page + evidence procedure | `docs/trading-agent/partners/README.md` |
| Per-broker evidence pages | `docs/trading-agent/partners/{binance,upstox,alpaca}.md` |
| Tracker schema and rules | `apps/api/src/trading_agent/partners/tracker.mjs` |
| Link ID config | `apps/api/src/trading_agent/partners/link_id.mjs` |
| Tests | `apps/api/test/trading_partners.test.js` (21) |

## Rules enforced

- **Partner states.** `UNVERIFIED → APPLIED → IN_REVIEW → PARTNER_APPROVED`, or `DECLINED`. This is a separate axis from the code state.
- **Every state change cites evidence ids.** Each evidence entry is a **reference** (`documentRef`) to a document the founder holds, `providedBy: "founder"`, with a written `kind`: signed agreement, email, letter, portal record or ticket. Verbal kinds (verbal, call, meeting, conversation) are refused by name.
- **PARTNER_APPROVED needs written broker confirmation** (signed agreement, email or letter; a portal record is not enough). Every item in the broker's `approvalRequires` must also be evidenced. For Binance that means the application, the acceptance, the Link ID fingerprint and the written rebate-API answer (Exchange Link vs Link-and-Trade decides which Stage 21 rebate source is real).
- **The tracker can't hold secrets.** Keys such as `linkId`, `secret` or `token` are refused, and a test checks the partner docs for anything shaped like a Link ID.

## Link ID configuration

- **Where the value lives.** The secret `TRADING_BINANCE_LINK_ID` is entered by the founder, without `x-`. Git holds only `linkIdFingerprint()`: a consistency check, not secrecy.
- **Validation.** `linkIdProblems()` rejects:
  - an `x-` prefix (the adapter adds it);
  - surrounding whitespace (rejected rather than silently trimmed);
  - non-ASCII or length outside 4–16.

  It agrees with the adapter's `linkPrefix` (tested), and error messages never echo the value.
- **Testnet:** any valid value resolves.
- **Production:** the value resolves only when the Binance tracker entry is PARTNER_APPROVED **and** the evidenced fingerprint matches. Production is also refused while `LIVE_TRADING` is locked.
- **Not wired.** Nothing calls `resolveBinanceLinkId` yet, and no secret was set anywhere.

## Test evidence (2026-10-06)

- `trading_partners.test.js`: 21 passing. It covers:
  - the committed tracker is valid and all-UNVERIFIED;
  - the pages agree with the JSON;
  - no Link ID in the docs;
  - prefix validation;
  - secret-store resolution, including that errors don't echo the value;
  - production gating;
  - 14 seeded violations, each refused.
- Mutation checks: 15 of 15 killed.
- The blocker register and the Binance adapter suites still pass.

## Blocker impact

| Blocker | Touched? | Note |
|---|---|---|
| B-09 (scope / legal) | yes, **not resolved** | the tracker is where partner agreements will be evidenced; none is |
| B-08 | referenced | the Link ID lives in the secret store; KMS is still pending (Stage 28) |
| Others | no | |

No blocker changes status. The Stage 32 row is added to the acceptance log in `docs/trading-agent/BLOCKERS.md`.

## Needs the founder

For each broker, give written document references for whatever exists: application, acceptance or agreement, Link ID email, and the rebate, order or commission terms answers. Enter the Binance Link ID into the secret store yourself. Anything you only have verbally needs to be requested in writing first.

## Rollback

Revert the commit. It is additive: docs plus an unwired module.
