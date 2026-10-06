# Upstox COPILOT connector (Stage 22)

Upstox behind the Stage 10 `BrokerAdapter` contract, **COPILOT mode only** (per-order human
confirmation). State: **IMPLEMENTED/TESTED only**:
- the `UPSTOX_COPILOT` flag stays OFF, and nothing is mounted;
- production is refused while `LIVE_TRADING` is locked;
- `UPSTOX_AUTOMATED` is locked, so `X-Algo-Name` is never sent.

| File | Purpose |
|---|---|
| `config.mjs` | sandbox / production hosts, segments, 12 h cooling constant, `algoHeaders()` (the only `X-Algo-Name` source, locked) |
| `rest_client.mjs` | bearer token per call; one request, no retry; UDAPI code → BrokerError mapping |
| `oauth.mjs` | authorization-code flow with an HMAC-signed, expiring, user-bound `state`; token expiry 03:30 IST |
| `token_vault.mjs` | AES-256-GCM envelopes bound (AAD) to principal + account + expiry; injected keyring; in-memory store only |
| `copilot.mjs` | order digest + `requireConfirmation()` (human, exact terms, ≤ 10 min, per action) |
| `placement.mjs` | U8 policy: API only from a dedicated, exclusive, registered per-customer IP; else PREPARE_ONLY + order ticket |
| `mapping.mjs` | LIMIT order body (exact price), details / stream snapshots, trades → fills, IST timestamps |
| `static_ip.mjs` | `GET /v2/user/ip` (read-only) |
| `kill_switch.mjs` | `/v2/user/kill-switch` status / engage / release (open-position and 12 h cooling checks); Stage 15 scope → venue proposal |
| `portfolio_stream.mjs` | one-time authorized wss URL; order / position / holding updates |
| `adapter.mjs` | `UpstoxCopilotAdapter` (place / modify / cancel / status / fills, prepareOrder, staticIps, killSwitch, openPortfolioStream) |

`executionSafety` is `AT_MOST_ONCE`, because Upstox doesn't dedupe tags. The Stage 17 OMS therefore refuses
Upstox for automated dispatch: COPILOT orders go through the adapter after a human confirms each one.
