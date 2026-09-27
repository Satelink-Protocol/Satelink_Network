# CONFLICT_REGISTER

| ID | Contradiction | Sources | Decision | Reason |
|---|---|---|---|---|
| C-01 | Test baseline "321 pass / 19 fail" | contract §1 vs run on 4b2865f | Reality: api 351 pass / 76 pending / 7 fail; vitest 283/283 | Reality wins (§1). Evidence: evidence/api-test-failures-2026-09-27.txt |
| C-02 | Flag `USAGE_LIMITS_V2` | contract §1 vs `pricing_v2/metering.mjs:23` | Code name is `SATELINK_USAGE_LIMITS_V2_ENABLED` | Code is what production reads |
| C-03 | `CONSOLE_ACCOUNTS_V1` listed as "UI-only flag" (§3 autonomy) | contract §3 vs `credit_service.mjs:175` | Treated as money-path on Railway (changes the deduction transaction); UI-only on Vercel | Flag switches authorizeAndMeter to `deductWithAccountLimits` |
| C-04 | "TI charges only after success" (#429) vs RPC | #429 vs `rpc_gateway.js:294,435` | RPC still pre-deducts with no refund on 502 — open defect F-1 | Code evidence |
| C-05 | "Dodo money pays ONLY for Trading Intelligence" | contract §1 vs `internal_dodo.js:704` | Violated today: Dodo credit packs land in `api_credits.credits_usdt` (RPC balance) — open defect F-2 | Code + prod rows 349/350 |
| C-06 | Revenue filter "is_test_data=false is the only filter" + founder wallets excluded | contract §1 vs payment_sources 349/350 | Founder TEST-mode Dodo payments are is_test_data=false and have an email payer, which the wallet-prefix filter cannot catch | Reclassification = FG-DODO-TESTDATA |
| C-07 | Contract path `~/satelink-prompts/…` | user instruction vs filesystem | File moved from ~/Downloads to ~/satelink-prompts on 2026-09-27 | Founder instruction |
| C-08 | Root CLAUDE.md "Frontend: https://app.satelink.network" | .claude/CLAUDE.md vs same file's own "app.satelink.network is DEAD" | Stale line — fix in H7 | Self-contradiction |
| C-09 | §1 contradictions 1–5 (free tier, RPC price per rail, x402 TI rows, V1 billing table, Dodo plans on RPC) | contract §1 | OPEN — Wave 2 (PRICING_TRUTH) | not yet resolved |
