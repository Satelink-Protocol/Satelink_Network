-- 009_ledger_txn_header.sql
-- M6.5: Ledger transaction header + schema corrections.
--
-- 1. ledger_txns — header table for ledger transactions.
--    Every ledger_entries row must reference a parent ledger_txns row.
-- 2. Backfill the one real txn from existing ledger_entries.
-- 3. FK constraint: ledger_entries.txn_id → ledger_txns.txn_id.
-- 4. Balance assertion: deferred constraint trigger ensures
--    SUM(debit) = SUM(credit) per txn_id at COMMIT.
-- 5. accounts.state CHECK: vocabulary is 'open' | 'closed'.
-- 6. draws.created_at: BIGINT (epoch ms) → TIMESTAMPTZ.
--    Table is empty after M6.5 cleanup, so this is free.

-- ═══════════════════════════════════════════════════════════════
-- 1. CREATE TABLE ledger_txns
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE ledger_txns (
    txn_id      text PRIMARY KEY,
    kind        text NOT NULL CHECK (kind IN
                  ('draw','settlement','deposit','adjustment','reversal')),
    ref_type    text NOT NULL,
    ref_id      text NOT NULL,
    currency    text NOT NULL,
    state       text NOT NULL CHECK (state IN ('pending','posted','voided')),
    posted_at   timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- 2. Backfill from existing ledger_entries
--    Derives kind='deposit', ref_type, ref_id, currency, state
--    from the entries. NOT hardcoded.
-- ═══════════════════════════════════════════════════════════════

INSERT INTO ledger_txns (txn_id, kind, ref_type, ref_id, currency, state, posted_at, created_at)
SELECT DISTINCT ON (le.txn_id)
    le.txn_id,
    'deposit'::text,
    le.ref_type,
    le.ref_id,
    le.currency,
    le.state,
    le.posted_at,
    le.created_at
FROM ledger_entries le
WHERE NOT EXISTS (SELECT 1 FROM ledger_txns lt WHERE lt.txn_id = le.txn_id)
ORDER BY le.txn_id, le.id;

-- ═══════════════════════════════════════════════════════════════
-- 3. FK constraint: ledger_entries.txn_id → ledger_txns.txn_id
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE ledger_entries
    ADD CONSTRAINT ledger_entries_txn_fk
    FOREIGN KEY (txn_id) REFERENCES ledger_txns(txn_id);

-- ═══════════════════════════════════════════════════════════════
-- 4. Balance assertion — deferred constraint trigger
--    At COMMIT, for each affected txn_id, verifies that
--    SUM(amount) WHERE direction='debit' AND state<>'voided'
--    equals SUM(amount) WHERE direction='credit' AND state<>'voided'.
--    Raises exception naming the txn_id on mismatch.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION ledger_entries_balance_check()
RETURNS TRIGGER AS $$
DECLARE
    _txn_id text;
    _debit_sum numeric(38,0);
    _credit_sum numeric(38,0);
BEGIN
    _txn_id := NEW.txn_id;

    SELECT
        COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END), 0)
    INTO _debit_sum, _credit_sum
    FROM ledger_entries
    WHERE txn_id = _txn_id
      AND state <> 'voided';

    IF _debit_sum <> _credit_sum THEN
        RAISE EXCEPTION 'ledger balance violation: txn_id=% debit_sum=% credit_sum=%',
            _txn_id, _debit_sum, _credit_sum;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_ledger_entries_balance
    AFTER INSERT ON ledger_entries
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION ledger_entries_balance_check();

-- ═══════════════════════════════════════════════════════════════
-- 5. accounts.state CHECK constraint
--    Real rows are 'open'. Fixture 'active' rows are gone (M6.5 cleanup).
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE accounts ADD CONSTRAINT accounts_state_check
    CHECK (state IN ('open','closed'));

-- ═══════════════════════════════════════════════════════════════
-- 6. draws.created_at: BIGINT → TIMESTAMPTZ
--    Table is empty after M6.5 cleanup, so this is free.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE draws ALTER COLUMN created_at TYPE timestamptz
    USING to_timestamp(created_at / 1000.0);
