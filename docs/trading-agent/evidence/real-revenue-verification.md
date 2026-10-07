# REAL REVENUE GATE 1: verification procedure

> **Status: nothing to verify yet.** No real trade has happened (Stage 33), live billing isn't approved (Stage 27), and real-book posting for trading revenue is refused until Stage 20 is decided. This procedure is prepared in advance. The founder runs every step. The matching tool is read-only.

**Only real money counts.** The amount must be live (not test-mode or simulated), funded by an external customer or broker (never the founder), settled (received, not expected), and matched three ways with **zero variance**:

```
journal transaction (real book)  ↔  statement line (bank / wallet)  ↔  gateway or broker record
```

A path is **REAL-REVENUE-VERIFIED** only on its own evidence:
- **subscription:** Razorpay payment → settlement → bank credit;
- **rebate:** Binance rebate record → wallet credit.

## 1. Collect the inputs (founder; all kept outside git)

Put everything in one JSON bundle in a private folder **outside the repository** (for example `~/satelink-private/revenue/`). The tool refuses an input or report path inside the repository.

| Part | What | Source |
|---|---|---|
| `journal` | the real-book transactions for the records | read-only export from `ledger_txns` + `ledger_entries` (query below) |
| `accounts` | role of each account id: `revenue`, `receivable`, `cash`, `fee_expense`, `other` | founder classification |
| `sources` | each gateway / broker record: `type` (`razorpay_payment` or `binance_rebate`), `id`, `mode`, `status`, `fundedBy`, `grossMinor`, `feeMinor`, `taxMinor`, `currency`, `settlementId` | Razorpay live dashboard / settlement reconciliation report; Binance rebate records (Stage 21 `ExchangeLinkRebateSource`) and wallet history |
| `statementLines` | each bank or wallet credit: `path`, `ref`, `settlementId`, `direction`, `amountMinor`, `currency` | the founder's statements, cited by a **reference** such as `bank:<account nickname>/<yyyy-mm>#L<line>` |

Amounts are integer minor units as strings (paise for INR; the asset's smallest unit used in the books for USDT).

**Field rules:**
- `mode: "live"` only.
- `status: "settled"` only when the money has reached the bank or wallet.
- `fundedBy: "customer"` only when the founder has checked the payer is an external customer or the broker, not a founder card, account or wallet. Use `"founder"` for anything founder-funded; it is refused.

**Read-only journal export** (run in a read-only transaction):

```sql
BEGIN READ ONLY;
SELECT json_agg(t) FROM (
  SELECT x.txn_id AS "txnId", x.kind, x.ref_type AS "refType", x.ref_id AS "refId", x.currency, x.state, x.posted_at AS "postedAt",
         (SELECT json_agg(json_build_object('accountId', e.account_id, 'direction', e.direction, 'amount', e.amount::text,
                                            'currency', e.currency, 'state', e.state) ORDER BY e.id)
            FROM ledger_entries e WHERE e.txn_id = x.txn_id) AS entries
  FROM ledger_txns x
  WHERE x.ref_type IN ('razorpay_payment', 'binance_rebate')
) t;
ROLLBACK;
```

The `ref_type` values and revenue `kind`s these transactions will use are part of the Stage 20 decision. Adjust the filter to whatever is approved.

## 2. Run the matcher (read-only)

```
node scripts/trading/real-revenue-verify.mjs --input ~/satelink-private/revenue/<period>.json \
     --out ~/satelink-private/revenue/<period>-report.json --rows
```

- **Exit 0:** no issue; each path with items is REAL-REVENUE-VERIFIED.
- **Exit 1 (STOP):** any refusal or mismatch. Codes: `SIMULATED_OR_TEST`, `FOUNDER_FUNDED`, `FUNDING_UNVERIFIED`, `NOT_SETTLED`, `UNMATCHED_JOURNAL`, `UNMATCHED_STATEMENT`, `ORPHAN_STATEMENT_LINE`, `ORPHAN_JOURNAL`, `DUPLICATE`, `VARIANCE`, `CURRENCY_MISMATCH`, `JOURNAL_NOT_POSTED`, `JOURNAL_UNBALANCED`, `FEE_NOT_BOOKED`, `INVALID`. A variance on a settlement batch un-matches every payment in it.
- **Exit 2:** tool error, including a path inside the repository.

What it checks:
- **Journal:** posted, balanced, in the record's currency, with credits to receivable or revenue equal to the record's gross, and the fee plus tax on the fee booked to `fee_expense`.
- **Statement:** a credit equal to the settlement's net (the sum of gross − fee − tax over every record in the settlement).
- **Orphans:** no unmatched statement line, and no revenue journal without a record.

## 3. Record the evidence

Copy the verdicts, the report hash and the `--rows` output (ids only, no amounts) into [`first-real-revenue.md`](first-real-revenue.md). The repository is public, so the founder decides whether any amount is published. The statement and report files stay outside git, referenced by path and hash.

## 4. Receivable → revenue

- **Nothing is posted by the tool, and nothing is posted by hand.**
- Matched items are listed as **eligible** for recognition. The reclassification from receivable to revenue goes through the approved ledger process (Stage 20), citing the matched evidence row.
- Items already credited to revenue must still match. A revenue journal without a matching record is a STOP (`ORPHAN_JOURNAL`).

## 5. Corrections (rollback)

- Correcting entries only: a `reversal` transaction whose entries point at the original via `reverses_entry_id`, then the right entry. **Never delete or edit a ledger row.**
- After a correction, export again and rerun the matcher. The evidence cites the new report hash.

## Not in scope

The existing reconcilers (`workers/reconciler`, on-chain deposits for RPC credits) and Satelink's RPC revenue (x402, USDT deposits) are a separate stream and are **not** part of this gate. They aren't run or counted here.
