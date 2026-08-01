-- 002_accounts.sql
-- M2: Financial accounts.
--
-- Each account belongs to a principal and tracks a single currency.
-- Normality indicates whether the account's natural balance direction is
-- debit (asset/expense) or credit (liability/revenue/equity).
--
-- Balance is NEVER stored as a mutable column. It is DERIVED from
-- ledger_entries (see 003). This table stores only the account's metadata.

CREATE TABLE accounts (
    id                  TEXT        PRIMARY KEY,
    principal_id        TEXT        NOT NULL REFERENCES principals(id),
    kind                TEXT        NOT NULL,
    normality           TEXT        NOT NULL CHECK (normality IN ('debit', 'credit')),
    currency            TEXT        NOT NULL,
    decimals            SMALLINT    NOT NULL,
    balance_invariant   TEXT,
    state               TEXT        NOT NULL DEFAULT 'open',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One account per principal per kind per currency
CREATE UNIQUE INDEX idx_accounts_principal_kind_currency
    ON accounts (principal_id, kind, currency);
