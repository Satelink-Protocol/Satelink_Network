/**
 * Outbox publisher — drains unpublished domain events, at-least-once.
 *
 * An event is marked published ONLY after delivery succeeds; a crash between
 * delivery and marking re-delivers next cycle, so consumers must be idempotent
 * on event_id (the outbox PK already dedupes emission). A delivery that throws
 * leaves the row unpublished for retry and does not block later events.
 */

import type { Queryable } from '../db.js';

export interface OutboxEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly severity: string;
  readonly payload: unknown;
}

/** Delivers one event to its sink. Throwing means "not delivered — retry". */
export type Deliver = (event: OutboxEvent) => Promise<void>;

export interface PublishResult {
  readonly publishedCount: number;
  readonly failedCount: number;
}

interface OutboxRow {
  readonly event_id: string;
  readonly event_type: string;
  readonly severity: string;
  readonly payload: unknown;
}

/** Default delivery: POST to a webhook if configured, otherwise ack-only. */
export function webhookDeliver(outboxWebhookUrl: string): Deliver {
  return async (event: OutboxEvent): Promise<void> => {
    if (outboxWebhookUrl.trim() === '') return; // ack-only: the outbox table is the log
    const res = await fetch(outboxWebhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
    });
    if (!res.ok) throw new Error(`outbox delivery HTTP ${res.status}`);
  };
}

export async function publishOnce(
  exec: Queryable,
  deliver: Deliver,
  limit = 100,
): Promise<PublishResult> {
  const res = await exec.query<OutboxRow>(
    `SELECT event_id, event_type, severity, payload
       FROM outbox
      WHERE published_at IS NULL
      ORDER BY created_at
      LIMIT $1`,
    [limit],
  );

  let publishedCount = 0;
  let failedCount = 0;
  for (const row of res.rows) {
    try {
      await deliver({
        eventId: row.event_id,
        eventType: row.event_type,
        severity: row.severity,
        payload: row.payload,
      });
    } catch {
      failedCount += 1;
      continue; // leave unpublished — retried next cycle
    }
    await exec.query(
      `UPDATE outbox SET published_at = now() WHERE event_id = $1 AND published_at IS NULL`,
      [row.event_id],
    );
    publishedCount += 1;
  }
  return { publishedCount, failedCount };
}
