-- 030_billing_subscriptions — Stage 27: gateway-neutral subscriptions, webhook events, payments,
-- invoices (+ lines) for the Trading Agent plans. Additive only; nothing existing is altered.
--
-- Mapping (audit 07 §subscriptions/invoices):
--   * invoices / invoice_lines: NEW, as audit 07 proposes; invoice_lines.ledger_txn_id → ledger_txns
--     (stays NULL until real-book posting is approved — Stage 20 / U2; test mode posts to a sim book).
--   * subscriptions: audit 07 suggests MAPPING onto pv2_subscriptions, but that table's primary key is
--     dodo_subscription_id and pv2_entitlements drives live Trading Intelligence metering; reusing them
--     would change existing billing for legacy customers (forbidden by the brief). This stage keeps a
--     separate, gateway-neutral billing_subscriptions table; consolidation is a later, founder-reviewed step.
--
-- GST: invoices carry GST METADATA fields only (GSTINs, place of supply, SAC code, tax breakdown as
-- JSON). No tax is computed here; format and numbering are RPrC (require professional review).

CREATE TABLE billing_subscriptions (
    id                       TEXT        PRIMARY KEY CHECK (id ~ '^bsub_[A-Za-z0-9_-]{4,64}$'),
    principal_id             TEXT        NOT NULL REFERENCES principals(id),
    gateway                  TEXT        NOT NULL CHECK (gateway IN ('razorpay')),
    gateway_subscription_id  TEXT,
    mode                     TEXT        NOT NULL CHECK (mode IN ('test', 'live')),
    plan_id                  TEXT        NOT NULL,
    catalog_version          TEXT        NOT NULL,
    status                   TEXT        NOT NULL CHECK (status IN ('pending_authentication', 'authenticated', 'active', 'past_due', 'suspended', 'paused', 'ended')),
    gateway_status           TEXT,
    current_period_start     TIMESTAMPTZ,
    current_period_end       TIMESTAMPTZ,
    grace_until              TIMESTAMPTZ,
    last_event_at            BIGINT      NOT NULL DEFAULT 0,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((status = 'past_due') = (grace_until IS NOT NULL))
);
CREATE UNIQUE INDEX billing_subscriptions_gateway_id ON billing_subscriptions (gateway, gateway_subscription_id) WHERE gateway_subscription_id IS NOT NULL;
CREATE INDEX billing_subscriptions_principal ON billing_subscriptions (principal_id);
-- one live (non-ended) subscription per principal and mode
CREATE UNIQUE INDEX billing_subscriptions_one_open ON billing_subscriptions (principal_id, mode) WHERE status <> 'ended';

-- Every verified webhook, once (x-razorpay-event-id). Append-only.
CREATE TABLE billing_webhook_events (
    gateway        TEXT        NOT NULL CHECK (gateway IN ('razorpay')),
    event_id       TEXT        NOT NULL CHECK (length(event_id) BETWEEN 1 AND 128),
    event_type     TEXT        NOT NULL,
    payload_hash   TEXT        NOT NULL CHECK (payload_hash ~ '^sha256:[0-9a-f]{64}$'),
    outcome        TEXT        NOT NULL,
    received_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (gateway, event_id)
);

-- Settled (or failed) gateway payments, once per gateway payment id. Append-only.
CREATE TABLE billing_payments (
    gateway             TEXT        NOT NULL CHECK (gateway IN ('razorpay')),
    gateway_payment_id  TEXT        NOT NULL,
    subscription_id     TEXT        NOT NULL REFERENCES billing_subscriptions(id),
    mode                TEXT        NOT NULL CHECK (mode IN ('test', 'live')),
    status              TEXT        NOT NULL CHECK (status IN ('captured', 'failed')),
    amount_minor        BIGINT      NOT NULL CHECK (amount_minor >= 0),
    currency            TEXT        NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    gateway_invoice_id  TEXT,
    occurred_at         TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (gateway, gateway_payment_id)
);

-- Invoices: one per captured payment. Append-only (corrections are credit notes, not edits).
CREATE TABLE invoices (
    id                  TEXT        PRIMARY KEY CHECK (id ~ '^inv_[A-Za-z0-9_-]{4,64}$'),
    principal_id        TEXT        NOT NULL REFERENCES principals(id),
    subscription_id     TEXT        NOT NULL REFERENCES billing_subscriptions(id),
    kind                TEXT        NOT NULL CHECK (kind IN ('invoice', 'credit_note')),
    mode                TEXT        NOT NULL CHECK (mode IN ('test', 'live')),
    gateway             TEXT        NOT NULL,
    gateway_payment_id  TEXT,
    currency            TEXT        NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_minor         BIGINT      NOT NULL CHECK (total_minor >= 0),
    period_start        TIMESTAMPTZ,
    period_end          TIMESTAMPTZ,
    issued_at           TIMESTAMPTZ NOT NULL,
    -- GST metadata (RPrC: format, numbering and tax treatment need professional review)
    supplier_gstin      TEXT,
    customer_gstin      TEXT,
    place_of_supply     TEXT,
    sac_code            TEXT,
    tax_breakdown       JSONB,
    gst_review_status   TEXT        NOT NULL DEFAULT 'rprc_pending' CHECK (gst_review_status IN ('rprc_pending', 'reviewed')),
    UNIQUE (gateway, gateway_payment_id, kind)
);
CREATE INDEX invoices_principal ON invoices (principal_id, issued_at DESC);

CREATE TABLE invoice_lines (
    invoice_id     TEXT    NOT NULL REFERENCES invoices(id),
    line_no        INTEGER NOT NULL CHECK (line_no >= 1),
    description    TEXT    NOT NULL,
    quantity       INTEGER NOT NULL CHECK (quantity >= 1),
    unit_minor     BIGINT  NOT NULL CHECK (unit_minor >= 0),
    amount_minor   BIGINT  NOT NULL CHECK (amount_minor >= 0),
    ledger_txn_id  TEXT    REFERENCES ledger_txns(txn_id),
    PRIMARY KEY (invoice_id, line_no)
);

-- Append-only guards (029's function; refuses UPDATE / DELETE / TRUNCATE for every role).
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['billing_webhook_events', 'billing_payments', 'invoices', 'invoice_lines'] LOOP
        EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION trading_append_only_guard()', t || '_append_only', t);
        EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION trading_append_only_guard()', t || '_no_truncate', t);
    END LOOP;
END $$;

REVOKE UPDATE, DELETE, TRUNCATE ON billing_webhook_events, billing_payments, invoices, invoice_lines FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'satelink_app') THEN
        EXECUTE 'GRANT SELECT, INSERT ON billing_webhook_events, billing_payments, invoices, invoice_lines TO satelink_app';
        EXECUTE 'GRANT SELECT, INSERT, UPDATE ON billing_subscriptions TO satelink_app';
        EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON billing_webhook_events, billing_payments, invoices, invoice_lines FROM satelink_app';
    END IF;
END $$;
