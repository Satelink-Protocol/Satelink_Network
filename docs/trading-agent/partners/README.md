# Partner validation tracker

**Every broker is UNVERIFIED. No partner evidence has been provided.** Nothing here says, or may be read as, a partnership, approval or affiliation. The machine-readable tracker is [`partners.json`](partners.json); a test keeps it and these pages in step.

| Broker | Programme | Partner state | Code state (separate axis) | Page |
|---|---|---|---|---|
| Binance | Binance Link (programme type not yet determined) | **UNVERIFIED** | IMPLEMENTED/TESTED | [binance.md](binance.md) |
| Upstox | Business / multi-customer API integration | **UNVERIFIED** | IMPLEMENTED/TESTED | [upstox.md](upstox.md) |
| Alpaca | Broker API (correspondent) | **UNVERIFIED** | IMPLEMENTED/TESTED | [alpaca.md](alpaca.md) |

The partner state and the code state are separate. The code state (`apps/web/src/lib/trading-agent/status.ts`) says what we built and tested. The partner state says what the broker has agreed to in writing. Neither one moves the other.

## States

`UNVERIFIED` → `APPLIED` → `IN_REVIEW` → `PARTNER_APPROVED`, or `DECLINED`.

- **Every change cites evidence.** A state change with no evidence id is invalid.
- **APPLIED** needs a reference to the submitted application.
- **PARTNER_APPROVED** needs a **written** confirmation from the broker (signed agreement, email or letter), and every item the broker lists in `approvalRequires` must be evidenced. For Binance that includes the Link ID fingerprint and the written rebate-API answer.
- **DECLINED** needs written evidence too.

## Recording evidence (founder only)

1. The founder gives a **reference** to a document they hold: an email Message-ID or subject and date, an agreement id, a portal record or a ticket number. Not the document itself.
2. It is added to the broker's `evidence` list as `{ id: "EV-BIN-001", kind, documentRef, providedBy: "founder", receivedAt, summary }`, where `kind` is `signed_agreement`, `email`, `letter`, `portal_record` or `ticket`.
3. **Verbal evidence is refused** (call, meeting, conversation). Ask for it in writing, then record it.
4. Items and state changes cite evidence ids. The validator rejects anything uncited, unknown or out of order.
5. This repository is **public**. Put no personal data, no document contents, no Link ID value and no secrets here.

## Binance Link ID

- The founder enters the Link ID into the secret store as `TRADING_BINANCE_LINK_ID`, without the `x-` prefix (4–16 letters or digits). The adapter adds the prefix.
- Only its fingerprint goes into the tracker. Compute it with `linkIdFingerprint()` from `apps/api/src/trading_agent/partners/link_id.mjs`.
- **In production**, the Link ID resolves only when the tracker says PARTNER_APPROVED **and** the fingerprint matches. Production is also refused while `LIVE_TRADING` is locked.
- **On the testnet**, any valid Link ID resolves.
