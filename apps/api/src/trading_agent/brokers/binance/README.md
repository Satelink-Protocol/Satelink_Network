# Binance Spot connector (Stage 21)

Native adapter behind the Stage 10 `BrokerAdapter` contract. State: **IMPLEMENTED/TESTED only**:
the `BINANCE` flag stays OFF, nothing is mounted, and production is refused while `LIVE_TRADING`
is locked. Testnet-only until B-08 (KMS / isolated signer / static IP) and B-09 (scope + legal) are resolved.

| File | Purpose |
|---|---|
| `config.mjs` | environments (Spot Testnet default; production refused unless `LIVE_TRADING`, which is LOCKED), client-id and Link ID rules |
| `signing.mjs` | HMAC-SHA256 (hex) and Ed25519 (base64) signing; REST query string; WebSocket API sorted payload |
| `rest_client.mjs` | one request per call, no retry; network/timeout/venue-error classification (`VENUE_UNAVAILABLE` / `AMBIGUOUS` / mapped code) |
| `key_validation.mjs` | `/sapi/v1/account/apiRestrictions` evaluation: refuse withdraw, internal transfer, universal transfer, no IP restriction |
| `mapping.mjs` | `x-<LinkID>` client-id translation, order snapshots (exact average price), `executionReport` → updates + fills |
| `exchange_info.mjs` | `exchangeInfo` → instrument specs (tick, lot, min qty, min notional) |
| `adapter.mjs` | `BinanceSpotAdapter`: place / query / cancel by client id, fills via `myTrades`, user data stream over the WebSocket API |
| `rebates.mjs` | read-only rebate sources: Exchange Link `recentRecord`; Link-and-Trade placeholder. Nothing is booked (Stage 20 stopped) |

Rules:
- Credentials come only from the injected `CredentialLoader` (`{apiKey, keyType: 'hmac'|'ed25519', secret|privateKeyPem}`);
  nothing here reads `process.env`, logs, or returns a secret.
- `clientOrderIdMaxLength = 36 − len("x-<LinkID>")`, so the OMS id plus the prefix always fits Binance's 36.
- Binance refuses a duplicate `newClientOrderId` only while that order is OPEN; the OMS therefore reconciles
  from history (GET `/api/v3/order?origClientOrderId=`) before any resend and never resends `UNKNOWN` blind.
- Queries need a symbol: kept in memory from `placeOrder`, or resolved via an injected `orderDirectory` after a restart.
- User data: `session.logon` + `userDataStream.subscribe` (Ed25519) or `userDataStream.subscribe.signature` (HMAC). No listenKey.
- Key restrictions are enforced before the first order wherever `/sapi` exists (`enforceKeyRestrictions`, default on outside the testnet).
