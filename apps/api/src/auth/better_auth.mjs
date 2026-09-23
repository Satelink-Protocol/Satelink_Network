// Track B (P5 backend) — Better Auth integration for customer accounts.
//
// SAFETY: this module is INERT by default. betterAuth is only imported (lazily)
// and the instance is only built when AUTH_ENABLED === 'true' AND the required
// secrets are present. It is NOT mounted into app_factory in this PR — see
// mountBetterAuth + docs: the founder decides the /api/auth namespace (the
// existing createUnifiedAuthRouter also mounts there) and runs the Better Auth
// schema migration (`npx @better-auth/cli migrate`) before enabling. Nothing
// here changes existing auth or money-path behaviour while the flag is off.
//
// Providers/plugins configured (per the confirmed better-auth API):
//   email + password (verification required, min 10), magic link, Google, Apple
//   (runtime ES256 client secret via jose — Apple rejects secrets valid > 6mo),
//   sessions (cross-subdomain cookie on .satelink.network), 2FA (TOTP), JWT,
//   rate limiting. Email is sent via Resend; if RESEND_API_KEY is absent, email
//   flows are disabled with a clear error (never silently log-only, §6.2).

let _authInstance = null;
let _nodeHandler = null;

export function isBetterAuthEnabled() {
  return process.env.AUTH_ENABLED === 'true' && !!process.env.BETTER_AUTH_SECRET;
}

export function emailEnabled() {
  return !!process.env.RESEND_API_KEY;
}

function googleConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function appleConfigured() {
  return !!(process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY);
}

/** Generate Apple's ES256 client-secret JWT at runtime (max ~6 months, Apple
 *  rejects longer). Built lazily with jose so it never runs unless Apple is
 *  configured and auth is enabled. */
async function appleClientSecret() {
  const { SignJWT, importPKCS8 } = await import('jose');
  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(process.env.APPLE_PRIVATE_KEY, 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: process.env.APPLE_KEY_ID })
    .setIssuer(process.env.APPLE_TEAM_ID)
    .setIssuedAt(now)
    .setExpirationTime(now + 60 * 60 * 24 * 150) // ~5 months
    .setAudience('https://appleid.apple.com')
    .setSubject(process.env.APPLE_CLIENT_ID)
    .sign(key);
}

async function sendEmailViaResend(to, subject, html) {
  if (!emailEnabled()) throw new Error('email_disabled: RESEND_API_KEY not set');
  const { Resend } = await import('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({ from: process.env.AUTH_EMAIL_FROM || 'no-reply@satelink.network', to, subject, html });
}

/** Build (and cache) the Better Auth instance. Returns null when disabled. */
export async function getBetterAuth(pool) {
  if (!isBetterAuthEnabled()) return null;
  if (_authInstance) return _authInstance;

  const { betterAuth } = await import('better-auth');
  const { magicLink, twoFactor, jwt } = await import('better-auth/plugins');

  const socialProviders = {};
  if (googleConfigured()) {
    socialProviders.google = {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    };
  }
  if (appleConfigured()) {
    socialProviders.apple = {
      clientId: process.env.APPLE_CLIENT_ID,
      // Function form so the ES256 JWT is regenerated (never a stale > 6mo secret).
      clientSecret: await appleClientSecret(),
    };
  }

  _authInstance = betterAuth({
    database: pool,
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL || 'https://api.satelink.network',
    emailAndPassword: {
      enabled: emailEnabled(),
      requireEmailVerification: true,
      minPasswordLength: 10,
      sendResetPassword: async ({ user, url }) => {
        await sendEmailViaResend(user.email, 'Reset your Satelink password',
          `<p>Reset your password: <a href="${url}">${url}</a></p>`);
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmailViaResend(user.email, 'Verify your Satelink email',
          `<p>Verify your email: <a href="${url}">${url}</a></p>`);
      },
    },
    socialProviders,
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await sendEmailViaResend(email, 'Your Satelink sign-in link',
            `<p>Sign in: <a href="${url}">${url}</a></p>`);
        },
      }),
      twoFactor(),
      jwt(),
    ],
    session: {
      cookieCache: { enabled: true, maxAge: 60 * 5 },
    },
    advanced: {
      cookiePrefix: 'satelink',
      // Sessions shared across *.satelink.network; Apple form_post needs the
      // state cookie to be SameSite=None on the callback (handled by Better Auth
      // per-provider); the session cookie stays Lax.
      crossSubDomainCookies: { enabled: true, domain: '.satelink.network' },
      defaultCookieAttributes: { sameSite: 'lax', secure: true },
    },
    rateLimit: { enabled: true, window: 60, max: 20 },
  });

  return _authInstance;
}

/** Mount Better Auth on the given Express app when enabled. Returns whether it
 *  mounted. NOT called from app_factory in this PR (see module header): the
 *  founder adds the call after choosing the /api/auth namespace and running the
 *  schema migration. Lazy: the handler initializes on first request. */
export function mountBetterAuth(app, pool, basePath = '/api/auth') {
  if (!isBetterAuthEnabled()) return false;
  app.all(`${basePath}/*`, async (req, res, next) => {
    try {
      if (!_nodeHandler) {
        const [{ toNodeHandler }, auth] = await Promise.all([
          import('better-auth/node'),
          getBetterAuth(pool),
        ]);
        if (!auth) return next();
        _nodeHandler = toNodeHandler(auth);
      }
      return _nodeHandler(req, res);
    } catch (err) {
      console.error('[better-auth] handler error:', err.message);
      return res.status(500).json({ ok: false, error: 'auth_unavailable' });
    }
  });
  return true;
}

// Test seam.
export function __reset() { _authInstance = null; _nodeHandler = null; }
