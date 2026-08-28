/**
 * Guardrail alert delivery (Brevo) + fire-once state persistence.
 *
 * Delivery is fail-open: a Brevo/network error is logged and swallowed so the
 * reconciler loop is never wedged by an outbound email failure. When
 * BREVO_API_KEY is absent the alert is logged (still visible) rather than sent.
 */

import type pg from 'pg';
import type { Alert } from './evaluate.js';

export type SendAlert = (alert: Alert) => Promise<void>;

export interface BrevoConfig {
  readonly apiKey: string; // '' → log-only
  readonly toEmail: string;
  readonly fromEmail: string;
  readonly fromName: string;
}

/** Build the real Brevo sender. Never throws. */
export function brevoSender(cfg: BrevoConfig, log: Pick<Console, 'info' | 'error'> = console): SendAlert {
  return async (alert: Alert): Promise<void> => {
    const subject = `[Satelink ${alert.severity.toUpperCase()}] ${alert.title}`;
    if (cfg.apiKey === '' || cfg.toEmail === '') {
      log.error(`[guardrails] ALERT (email not configured): ${subject} — ${alert.detail}`);
      return;
    }
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'api-key': cfg.apiKey },
        body: JSON.stringify({
          sender: { email: cfg.fromEmail, name: cfg.fromName },
          to: [{ email: cfg.toEmail }],
          subject,
          textContent: `${alert.title}\n\n${alert.detail}\n\ncondition=${alert.condition} key=${alert.key}`,
        }),
      });
      if (!res.ok) {
        log.error(`[guardrails] Brevo send failed http=${res.status} for ${alert.key}`);
      } else {
        log.info(`[guardrails] alert sent: ${alert.key}`);
      }
    } catch (err) {
      log.error(`[guardrails] Brevo send error for ${alert.key}:`, err);
    }
  };
}

/** Load the last-sent-ms map for fire-once dedup. */
export async function loadAlertState(pool: pg.Pool): Promise<Record<string, number>> {
  const { rows } = await pool.query<{ alert_key: string; ms: string }>(
    `SELECT alert_key, (extract(epoch FROM last_sent_at) * 1000)::bigint::text AS ms FROM guardrail_alert_state`,
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.alert_key] = Number(r.ms);
  return out;
}

/** Persist that these keys were just sent (upsert). */
export async function recordSent(pool: pg.Pool, keys: readonly string[], nowMs: number): Promise<void> {
  if (keys.length === 0) return;
  const ts = new Date(nowMs).toISOString();
  for (const key of keys) {
    await pool.query(
      `INSERT INTO guardrail_alert_state (alert_key, last_sent_at) VALUES ($1, $2)
         ON CONFLICT (alert_key) DO UPDATE SET last_sent_at = EXCLUDED.last_sent_at`,
      [key, ts],
    );
  }
}
