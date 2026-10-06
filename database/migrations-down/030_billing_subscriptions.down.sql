-- Rollback for 030_billing_subscriptions (local / ephemeral databases only). Run before 029's down.
DROP TABLE IF EXISTS invoice_lines;
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS billing_payments;
DROP TABLE IF EXISTS billing_webhook_events;
DROP TABLE IF EXISTS billing_subscriptions;
DELETE FROM schema_migrations WHERE filename = '030_billing_subscriptions.sql';
