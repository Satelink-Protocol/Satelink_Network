/**
 * Admin email sending — Brevo transactional API.
 *
 * Mounted under the admin router at /admin/email (so it inherits requireAdminAuth
 * / the x-admin-token gate from app_factory.mjs). The Vercel admin-proxy forwards
 * { path: '/email/send', method: 'POST', body } here.
 *
 * BREVO_API_KEY is set in the Railway env. The sender domain (satelink.network)
 * must be a verified sender in Brevo for delivery to succeed.
 */
export function emailRouter(express) {
  const router = express.Router();

  router.post('/send', async (req, res) => {
    const { to, subject, body } = req.body || {};
    if (!to || !subject || !body) return res.status(400).json({ error: 'Missing fields' });

    if (!process.env.BREVO_API_KEY) {
      return res.status(503).json({ error: 'BREVO_API_KEY not configured' });
    }

    try {
      const result = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': process.env.BREVO_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sender: { email: 'infra@satelink.network', name: 'Satelink Network' },
          to: [{ email: to }],
          subject,
          htmlContent: body,
        }),
      });

      if (!result.ok) {
        const err = await result.json().catch(() => ({}));
        return res.status(result.status).json({ error: err.message || `Brevo error ${result.status}` });
      }

      const data = await result.json();
      res.json({ ok: true, messageId: data.messageId });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}

export default emailRouter;
