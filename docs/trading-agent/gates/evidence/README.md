# REAL MONEY GATE 1 — evidence

Humans put evidence files here. `scripts/trading/real-money-gate.mjs` reads them, and never writes them. **No key material, ever:** key snapshots carry a 16-hex fingerprint only.

| File | Content |
|---|---|
| `gate-6.json` | `{ "runs": [{ "url": "https://github.com/…/actions/runs/<id>", "conclusion": "success", "testnet": "exercised", "date": "…" }] }`, the Stage 30 nightly runs |
| `gate-7.json` | `{ "<control>": { "done": true, "evidence": "<PR / doc link>" } }` for `kmsEnvelopeEncryption`, `dbRoleSeparation`, `staticEgressIp`, `ciSecretScan`, `ciLicenceScan`, `dailyKeyRecheck`, `adminStepUp`, `prodSecretsRotated` |
| `broker-keys/<broker>-<account>.json` | `{ "keyFingerprint": "<16 hex>", "capturedAt": "<iso>", "restrictions": <apiRestrictions response>, "whitelistedIps": ["…"] }`, captured by the founder with the adapter's `validateKey()` |
| `egress.json` | `{ "ip": "…", "region": "…", "provider": "…" }`, the execution service's static egress |
| `suites.json` | `{ "commit": "…", "recordedAt": "…", "tradingUnit": {"passes", "failures"}, "tradingIntegration": {…}, "baseline": {…} }` |
| `legal.json` | `{ "<item>": { "signedOffBy": "…", "date": "…" } }` for `scopeDecision`, `brokerTermsReview`, `riskDisclosure`, `tradingAgentTerms`, `gstInvoiceFormat` |
| `approvals.json` | `{ "approvals": [{ "approver", "role": "founder" or "independent_reviewer", "githubLogin", "evidenceHash", "approvedAt" }] }` |
