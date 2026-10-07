# trading_agent/revenue — shadow revenue engine (Stage 20, option 2)

A **projection**, not the ledger. It answers "what do we expect to earn, what has matched evidence
shown we actually earned, and what is the variance?" without writing anything anywhere.

| File | What |
|---|---|
| `accounts.mjs` | chart of accounts per book (`sim:` / `real:`); streams subscription, rebate, commission, usage |
| `posting_rules.mjs` | pure, deterministic posting rules; every posting balanced per currency |
| `engine.mjs` | `ShadowRevenueEngine` — sim + real books, idempotent, append-only, variance report |
| `evidence.mjs` | turns `scripts/trading/real-revenue-verify.mjs` output into settlement evidence (matched + REAL-REVENUE-VERIFIED only) |

Rules:
- **No ledger writes, no table, no schema change.** A test fails if this directory imports the
  Financial-OS ledger (`libs/financial-domain`, `services/financial`) or contains SQL.
- **Real vs sim never mix.** Simulated / test items are refused by the real book and vice versa.
- **Expected → actual only on matched evidence** (three-way: journal ↔ statement ↔ gateway/broker),
  customer-funded, settled, same currency, and never more than the open expected amount
  (`OVER_RECEIPT` → human review).
- Amounts are integer minor units (string or bigint), never floats.
- Flag `REVENUE_ENGINE` (`TRADING_FLAG_REVENUE_ENGINE`) is OFF by default; the constructor throws
  `DISABLED` when it is off.

Recognising revenue in the real Financial-OS ledger stays a founder decision (new `ledger_txns`
kinds, U2 prerequisites). This engine's variance report is the input to that process.
