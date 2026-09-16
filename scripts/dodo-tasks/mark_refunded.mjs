#!/usr/bin/env node
// scripts/dodo-tasks/mark_refunded.mjs
//
// Record-keeping ONLY. Dodo Payments refunds are issued by hand through
// Dodo's own dashboard — this script does NOT call any Dodo API and does
// NOT move money. It exists purely so task_orders (and therefore
// analytics.sql) reflects reality after a refund has already been issued
// manually. Run this AFTER completing the refund in Dodo's dashboard, never
// before. See REFUND_RUNBOOK.md for when/how to decide on and issue the
// actual refund.
//
// Usage:
//   node scripts/dodo-tasks/mark_refunded.mjs <order_ref>
//   node scripts/dodo-tasks/mark_refunded.mjs --list        (list orders eligible to be marked refunded)
//
// Required env: DATABASE_URL

import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('Missing required env: DATABASE_URL');
  process.exit(1);
}

// Only these statuses are legitimate refund candidates. pending_payment was
// never charged; refunded is already refunded (refusing a re-run guards
// against accidentally clobbering the original refunded_at timestamp).
const REFUNDABLE_STATUSES = ['paid', 'fulfilled', 'failed'];

async function main() {
  const orderRef = process.argv[2];
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    if (!orderRef || orderRef === '--list') {
      const { rows } = await client.query(
        `SELECT order_ref, status, city, category, buyer_email, price_inr, paid_at
           FROM task_orders
          WHERE status = ANY($1)
          ORDER BY paid_at ASC NULLS LAST`,
        [REFUNDABLE_STATUSES]
      );
      if (!rows.length) {
        console.log('No orders in a refundable status (paid, fulfilled, failed).');
      } else {
        console.log('Orders eligible to be marked refunded (refund must already be issued in Dodo\'s dashboard first):');
        for (const r of rows) {
          console.log(`  ${r.order_ref}  status=${r.status}  ₹${r.price_inr}  city="${r.city}" category="${r.category}" email=${r.buyer_email}`);
        }
        console.log('\nRun: node scripts/dodo-tasks/mark_refunded.mjs <order_ref>');
      }
      return;
    }

    const { rows } = await client.query(`SELECT * FROM task_orders WHERE order_ref = $1`, [orderRef]);
    const order = rows[0];
    if (!order) {
      console.error(`No task_orders row for order_ref=${orderRef}`);
      process.exitCode = 1;
      return;
    }
    if (!REFUNDABLE_STATUSES.includes(order.status)) {
      console.error(
        `Order ${orderRef} has status="${order.status}" — not one of [${REFUNDABLE_STATUSES.join(', ')}]. Refusing to mark refunded.`
      );
      process.exitCode = 1;
      return;
    }

    console.log(`About to mark ${orderRef} (currently status="${order.status}", ₹${order.price_inr}, ${order.buyer_email}) as refunded.`);
    console.log('This ONLY updates the database record. It does not issue a refund.');
    console.log('If you have not already issued the refund via the Dodo dashboard, stop now — see REFUND_RUNBOOK.md.');

    const { rows: updated } = await client.query(
      `UPDATE task_orders SET status = 'refunded', refunded_at = now(), updated_at = now()
        WHERE order_ref = $1 AND status = ANY($2)
        RETURNING order_ref, status, refunded_at`,
      [orderRef, REFUNDABLE_STATUSES]
    );

    if (!updated[0]) {
      // Status changed between the SELECT above and this UPDATE (e.g. a
      // concurrent run) — refuse rather than silently no-op.
      console.error(`Order ${orderRef} status changed before the update could apply. Re-run to check current state.`);
      process.exitCode = 1;
      return;
    }

    console.log(`Marked refunded: ${updated[0].order_ref} refunded_at=${updated[0].refunded_at}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('mark_refunded.mjs crashed:', err);
  process.exitCode = 1;
});
