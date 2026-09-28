// Track B (P5 backend) — Better Auth integration for customer accounts.
//
// SAFETY: this module is INERT by default. betterAuth is only imported (lazily)
// and the instance is only built when AUTH_ENABLED === 'true' AND the required
// secrets are present. It is NOT mounted into app_factory in this PR — see
// mountBetterAuth + docs. Nothing here changes existing auth or money-path
// behaviour while the flag is off.
//
// NAMESPACE (founder-confirmed 2026-09-23): mounts at /api/identity/*, never
// /api/auth — the existing createUnifiedAuthRouter already owns /api/auth, so
// there is no collision and no shared-namespace ambiguity to resolve. The web
// P5 UI calls /api/identity/sign-in/social and expects callbacks at
// /api/identity/callback/google; see docs/web/INFRA_SETUP.md for the exact
// OAuth redirect URI to register. The Better Auth schema migration
// (`npx @better-auth/cli migrate`) still has to run before enabling — see
// BETTER_AUTH.md.
//
// Providers/plugins configured (per the confirmed better-auth API):
//   email + password (verification required, min 10), magic link, Google.
//   Apple is out for now (A6, 2026-09-23) — not flag-gated, removed cleanly;
//   revisiting it later is new scope, not a resurrection.
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

const DEFAULT_TRUSTED_ORIGINS = [
  'https://satelink.network',
  'https://www.satelink.network',
  'https://console.satelink.network',
];

/** Comma-separated BETTER_AUTH_TRUSTED_ORIGINS overrides the default list. */
export function trustedOrigins() {
  const raw = process.env.BETTER_AUTH_TRUSTED_ORIGINS;
  if (!raw) return DEFAULT_TRUSTED_ORIGINS;
  return raw.split(',').map(s => s.trim()).filter(Boolean);
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
  // Apple is out for now (A6, 2026-09-23) — see module header.

  _authInstance = betterAuth({
    database: pool,
    secret: process.env.BETTER_AUTH_SECRET,
    // baseURL must include the mount path — Better Auth derives its own
    // callback URLs as `${baseURL}/callback/{provider}`. Default matches the
    // fixed /api/identity namespace (founder-confirmed 2026-09-23).
    baseURL: process.env.BETTER_AUTH_URL || 'https://api.satelink.network/api/identity',
    // Sign-in starts on the web hosts (proxied via /api/identity) and the
    // console subdomain; Better Auth rejects Origin/callbackURL values outside
    // baseURL's origin unless they are listed here.
    trustedOrigins: trustedOrigins(),
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
      // Sessions shared across *.satelink.network.
      crossSubDomainCookies: { enabled: true, domain: '.satelink.network' },
      defaultCookieAttributes: { sameSite: 'lax', secure: true },
    },
    rateLimit: { enabled: true, window: 60, max: 20 },
  });

  return _authInstance;
}

/** Mount Better Auth on the given Express app when enabled. Returns whether it
 *  mounted. NOT called from app_factory in this PR (see module header): the
 *  founder adds the call after running the Better Auth schema migration. The
 *  namespace is fixed at /api/identity (founder-confirmed 2026-09-23) — never
 *  /api/auth, which createUnifiedAuthRouter already owns. Lazy: the handler
 *  initializes on first request. */
export function mountBetterAuth(app, pool, basePath = '/api/identity') {
  if (!isBetterAuthEnabled()) return false;
  // Express 5 (path-to-regexp v8) requires a NAMED wildcard — a bare `/*`
  // throws "Missing parameter name" and crashes createApp. `/*splat` matches
  // every sub-path under basePath, which is what Better Auth's node handler needs.
  app.all(`${basePath}/*splat`, async (req, res, next) => {
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
