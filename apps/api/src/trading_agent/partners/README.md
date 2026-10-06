# trading_agent/partners

Stage 32. The partner-validation tracker schema (`tracker.mjs`) and the Binance Link ID configuration (`link_id.mjs`). The tracker data and the evidence procedure are in `docs/trading-agent/partners/`.

- No state changes without founder-provided written evidence; verbal evidence is refused.
- The Link ID value lives only in the secret store (`TRADING_BINANCE_LINK_ID`); git holds its fingerprint.
- Not wired into any route or job. Nothing here enables trading.
