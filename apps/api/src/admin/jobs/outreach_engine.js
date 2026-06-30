/**
 * Outreach Engine — queues developer follow-ups and posts Discord templates.
 *
 * Corrected vs the original design doc:
 *   - `pool` is a pg Pool: pool.query() returns { rows }
 *   - All DB calls are guarded; the tables may not exist until the migration runs.
 *
 * Templates make factual claims about the service. Keep them honest — do not
 * add uptime/redundancy numbers that aren't measured.
 */

const TEMPLATES = {
  'erpc-provider': {
    target: 'erpc #integrations',
    body: `Hey — we set up Satelink as a Polygon PoS RPC endpoint.

rpc.satelink.network (chain ID 137), latency-sorted routing across multiple providers.

Free tier: 500 calls/day. Paid: prepaid USDT credits.

Anyone running erpc on Polygon 137 — happy to share config or answer questions.`,
  },
  'followup-72h': {
    target: 'developer follow-up',
    body: `Following up — if you hit limits on your Polygon RPC provider, Satelink has a free tier at rpc.satelink.network (chain 137). Happy to help you get set up.`,
  },
};

async function sendBrevoEmail(to, subject, htmlContent) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return null; // gracefully skip if not configured

  try {
    const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sender: { name: 'Satelink Network', email: 'no-reply@satelink.network' },
        to: [{ email: to }],
        subject,
        htmlContent
      })
    });
    return resp.ok;
  } catch (_) { return null; }
}

export class OutreachEngine {
  constructor(pool) { this.pool = pool; }

  async q(sql, params) {
    const r = await this.pool.query(sql, params);
    return r.rows;
  }

  async run() {
    const results = [];
    let followUps = [];
    try {
      followUps = await this.q(
        `SELECT ip, outreach_attempts FROM developer_intel
          WHERE status = 'contacted'
            AND last_outreach_at < NOW() - INTERVAL '72 hours'
            AND outreach_attempts < 3`
      );
    } catch { /* table may not exist yet */ }

    for (const dev of followUps) {
      await this.q(
        `UPDATE developer_intel SET outreach_attempts = outreach_attempts + 1, last_outreach_at = NOW() WHERE ip = $1`,
        [dev.ip]
      ).catch(() => {});
      results.push({ action: 'followup_queued', ip: dev.ip, attempt: (dev.outreach_attempts || 0) + 1 });
    }
    return { processed: results.length, results };
  }

  async sendDiscord(templateId, customWebhook) {
    const template = TEMPLATES[templateId];
    if (!template) throw new Error(`Unknown template: ${templateId}`);
    const url = customWebhook || process.env.DISCORD_WEBHOOK_URL;
    if (!url) throw new Error('No Discord webhook configured');

    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: template.body, username: 'Satelink' }),
    });

    await this.q(
      `INSERT INTO outreach_campaigns (channel, template_id, target, message, status, sent_at)
       VALUES ('discord', $1, $2, $3, 'sent', NOW())
       ON CONFLICT (template_id) DO UPDATE SET status = 'sent', sent_at = NOW(), message = $3`,
      [templateId, template.target, template.body]
    ).catch(() => {});

    // Brevo email ready — opt-in lead emails are now collected at key creation
    // and via POST /api/keys/email (see billing/api_keys_route.mjs). The
    // outreach-eligible source is:
    //   SELECT email FROM api_credits WHERE email_consent = true AND email IS NOT NULL
    // Only send to consented addresses — never to inferred ISP/abuse contacts.
    // Call: await sendBrevoEmail(leadEmail, subject, html) when wiring Phase 2 sends.

    return { sent: true, template: templateId, target: template.target };
  }
}
