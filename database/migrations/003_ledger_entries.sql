-- 003_ledger_entries.sql
-- M2: Append-only double-entry ledger.
--
-- INVARIANTS enforced by this schema:
--   #1  Balance is DERIVED from entries (see account_balances view below).
--   #2  amount is NUMERIC(38,0) — integer minor units, matching Money.
--       No floats. CHECK (amount > 0) ensures only positive entries.
--   #3  Pending entries do NOT contribute to AVAILABLE balance
--       (see account_balances view: posted vs pending separation).
--   #5  Append-only: UPDATE and DELETE are revoked in 004.
--       Reversals are NEW entries referencing reverses_entry_id.
--   #6  Idempotency: UNIQUE on (idem_key, account_id, direction).

CREATE TABLE ledger_entries (
    id                  BIGSERIAL   PRIMARY KEY,
    txn_id              TEXT        NOT NULL,
    account_id          TEXT        NOT NULL REFERENCES accounts(id),
    direction           TEXT        NOT NULL CHECK (direction IN ('debit', 'credit')),
    amount              NUMERIC(38,0) NOT NULL CHECK (amount > 0),
    currency            TEXT        NOT NULL,
    state               TEXT        NOT NULL CHECK (state IN ('pending', 'posted', 'voided')),
    ref_type            TEXT        NOT NULL,
    ref_id              TEXT        NOT NULL,
    reverses_entry_id   BIGINT      REFERENCES ledger_entries(id),
    idem_key            TEXT        NOT NULL,
    posted_at           TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency: same key + account + direction = same entry
CREATE UNIQUE INDEX idx_ledger_entries_idem
    ON ledger_entries (idem_key, account_id, direction);

-- Balance computation: all entries for an account in a given state
CREATE INDEX idx_ledger_entries_account_state_created
    ON ledger_entries (account_id, state, created_at);

-- Transaction lookup: all legs of a transaction
CREATE INDEX idx_ledger_entries_txn_id
    ON ledger_entries (txn_id);

-- Reference lookup: all entries related to a domain event
CREATE INDEX idx_ledger_entries_ref
    ON ledger_entries (ref_type, ref_id);

-- ---------------------------------------------------------------------------
-- account_balances VIEW
--
-- Derives balance from entries (invariant #1). Separates posted from pending
-- (invariant #3): pending debits reduce available, pending credits do NOT
-- increase posted balance.
--
-- available = posted_credits - posted_debits - pending_debits
-- ---------------------------------------------------------------------------

CREATE VIEW account_balances AS
SELECT
    a.id                    AS account_id,
    a.principal_id,
    a.currency,
    a.decimals,
    a.normality,

    -- Posted totals
    COALESCE(SUM(CASE WHEN le.state = 'posted' AND le.direction = 'credit'
                      THEN le.amount ELSE 0 END), 0)
        AS posted_credits,

    COALESCE(SUM(CASE WHEN le.state = 'posted' AND le.direction = 'debit'
                      THEN le.amount ELSE 0 END), 0)
        AS posted_debits,

    -- Pending totals
    COALESCE(SUM(CASE WHEN le.state = 'pending' AND le.direction = 'debit'
                      THEN le.amount ELSE 0 END), 0)
        AS pending_debits,

    COALESCE(SUM(CASE WHEN le.state = 'pending' AND le.direction = 'credit'
                      THEN le.amount ELSE 0 END), 0)
        AS pending_credits,

    -- Derived balances
    COALESCE(SUM(CASE WHEN le.state = 'posted' AND le.direction = 'credit'
                      THEN le.amount ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN le.state = 'posted' AND le.direction = 'debit'
                        THEN le.amount ELSE 0 END), 0)
        AS posted_balance,

    -- Available: posted_credits - posted_debits - pending_debits
    -- (pending credits do NOT increase available — invariant #3)
    COALESCE(SUM(CASE WHEN le.state = 'posted' AND le.direction = 'credit'
                      THEN le.amount ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN le.state = 'posted' AND le.direction = 'debit'
                        THEN le.amount ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN le.state = 'pending' AND le.direction = 'debit'
                        THEN le.amount ELSE 0 END), 0)
        AS available_balance

FROM accounts a
LEFT JOIN ledger_entries le ON le.account_id = a.id AND le.state != 'voided'
GROUP BY a.id, a.principal_id, a.currency, a.decimals, a.normality;
