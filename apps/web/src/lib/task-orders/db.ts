// apps/web/src/lib/task-orders/db.ts
//
// Own Postgres connection pool for the task-commerce feature — isolated from
// apps/api's pool and money-path tables. Points at the SAME Postgres instance
// (there is only one), but the ONLY table this module ever touches is
// task_orders (see schema.sql). Server-only: never import this from a client
// component.
//
// DATABASE_URL here is a Vercel (apps/web) project env var, set to the
// Railway Postgres PUBLIC connection string — separate from the DATABASE_URL
// configured on Railway for apps/api, even though it points at the same DB.

import { Pool } from "pg";

// The deployed role (task_commerce_web) is scoped to SELECT/INSERT/UPDATE on
// task_orders ONLY — no CREATE privilege on the schema (least-privilege by
// design). So this module never attempts to create the table; it exists
// once, out-of-band, via an admin connection running schema.sql (source of
// truth for the DDL — keep that file in sync with any column change here).
// ensureTable() only CONFIRMS the table is there and fails loudly, naming
// it, if it isn't — never silently continues.
const TABLE_EXISTS_SQL = `
  SELECT EXISTS (
    SELECT FROM information_schema.tables WHERE table_name = 'task_orders'
  ) AS exists
`;

let pool: Pool | null = null;
let ensured: Promise<void> | null = null;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set (required for task_orders)");
    }
    pool = new Pool({
      connectionString,
      ssl: connectionString.includes("localhost") || connectionString.includes("127.0.0.1")
        ? false
        : { rejectUnauthorized: false },
      max: 5,
    });
  }
  return pool;
}

/**
 * Idempotent — safe to call on every request. Cached after the first success.
 * Confirms task_orders exists; never attempts to create it (the deployed
 * role has no CREATE privilege — see the module header). If the table is
 * missing, fails loudly and by name rather than silently continuing into
 * queries that would themselves fail confusingly later.
 */
async function ensureTable(): Promise<void> {
  if (!ensured) {
    ensured = getPool()
      .query<{ exists: boolean }>(TABLE_EXISTS_SQL)
      .then((r) => {
        if (!r.rows[0]?.exists) {
          throw new Error(
            "task_orders table does not exist. Run apps/web/src/lib/task-orders/schema.sql " +
            "against the database via an admin connection before deploying — the deployed " +
            "role (task_commerce_web) cannot create it itself."
          );
        }
      })
      .catch((err) => {
        ensured = null; // allow retry on the next call rather than caching a failure forever
        throw err;
      });
  }
  return ensured;
}

export type TaskOrderStatus = "pending_payment" | "paid" | "fulfilled" | "failed" | "refunded";

export interface TaskOrder {
  id: number;
  order_ref: string;
  status: TaskOrderStatus;
  city: string;
  category: string;
  buyer_email: string;
  price_inr: string;
  dodo_payment_id: string | null;
  dodo_customer_email: string | null;
  apify_run_id: string | null;
  apify_cost_usd: string | null;
  paid_at: string | null;
  fulfilled_at: string | null;
  refunded_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function createPendingOrder(params: {
  orderRef: string;
  city: string;
  category: string;
  buyerEmail: string;
}): Promise<void> {
  await ensureTable();
  await getPool().query(
    `INSERT INTO task_orders (order_ref, city, category, buyer_email, status)
     VALUES ($1, $2, $3, $4, 'pending_payment')`,
    [params.orderRef, params.city, params.category, params.buyerEmail]
  );
}

export type OrderMatchMethod = "order_ref" | "email_fallback" | "already_processed" | "none";

export interface MarkOrderPaidResult {
  order: TaskOrder | null;
  matchedVia: OrderMatchMethod;
}

/**
 * Mark an order paid. Matches by order_ref (from webhook metadata_order_ref
 * query-param pass-through) when present; falls back to the most recent
 * pending_payment row for the payer's email otherwise.
 *
 * The fallback exists because, as of this writing, Dodo's docs confirm the
 * metadata_* query-param SYNTAX for static payment links but do not
 * explicitly confirm that metadata set this way (as opposed to metadata set
 * via the API on a Checkout Session) reaches event.data.metadata on the
 * webhook — unverified against a live account. matchedVia tells the caller
 * which path actually fired so it can log a warning on every fallback use
 * (never silent) until this is confirmed one way or the other by a real
 * payment.
 *
 * Never throws — the webhook must still 2xx so Dodo doesn't retry forever.
 */
export async function markOrderPaid(params: {
  orderRef?: string | undefined;
  payerEmail?: string | undefined;
  dodoPaymentId: string;
  rawPayload: unknown;
}): Promise<MarkOrderPaidResult> {
  await ensureTable();
  const client = await getPool().connect();
  try {
    // Idempotency: a payment_id already recorded means this webhook was
    // already processed (Dodo retries until it sees a 2xx) — no-op, return
    // the existing row rather than re-matching/re-updating.
    const existing = await client.query<TaskOrder>(
      `SELECT * FROM task_orders WHERE dodo_payment_id = $1`,
      [params.dodoPaymentId]
    );
    if (existing.rows[0]) return { order: existing.rows[0], matchedVia: "already_processed" };

    if (params.orderRef) {
      const r = await client.query<TaskOrder>(
        `UPDATE task_orders
            SET status = 'paid', dodo_payment_id = $1, dodo_customer_email = $2,
                raw_webhook_payload = $3, paid_at = now(), updated_at = now()
          WHERE order_ref = $4 AND status = 'pending_payment'
          RETURNING *`,
        [params.dodoPaymentId, params.payerEmail ?? null, JSON.stringify(params.rawPayload), params.orderRef]
      );
      if (r.rows[0]) return { order: r.rows[0], matchedVia: "order_ref" };
    }

    if (params.payerEmail) {
      const r = await client.query<TaskOrder>(
        `UPDATE task_orders
            SET status = 'paid', dodo_payment_id = $1, dodo_customer_email = $2,
                raw_webhook_payload = $3, paid_at = now(), updated_at = now()
          WHERE id = (
            SELECT id FROM task_orders
             WHERE lower(buyer_email) = lower($2) AND status = 'pending_payment'
             ORDER BY created_at DESC LIMIT 1
          )
          RETURNING *`,
        [params.dodoPaymentId, params.payerEmail, JSON.stringify(params.rawPayload)]
      );
      if (r.rows[0]) return { order: r.rows[0], matchedVia: "email_fallback" };
    }

    return { order: null, matchedVia: "none" };
  } finally {
    client.release();
  }
}

export async function listPaidUnfulfilledOrders(): Promise<TaskOrder[]> {
  await ensureTable();
  const r = await getPool().query<TaskOrder>(
    `SELECT * FROM task_orders WHERE status = 'paid' ORDER BY paid_at ASC`
  );
  return r.rows;
}

export async function markOrderFulfilled(orderRef: string, apifyRunId: string): Promise<void> {
  await ensureTable();
  await getPool().query(
    `UPDATE task_orders
        SET status = 'fulfilled', apify_run_id = $2, fulfilled_at = now(), updated_at = now()
      WHERE order_ref = $1`,
    [orderRef, apifyRunId]
  );
}
