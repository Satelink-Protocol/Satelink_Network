// apps/web/src/lib/dodo/environment.ts
//
// Single source of truth for which Dodo Payments environment (test vs live)
// every server-side Dodo client in apps/web uses. The installed SDK
// (node_modules/dodopayments/client.d.ts:61, :144) defaults `environment` to
// `live_mode` when unset — silently creating real checkout sessions against
// a test-mode account (or vice versa) is exactly the failure mode this
// closes. Deliberately NOT read at module load: importing this file must
// never crash Next.js's build-time page-data collection (same reasoning as
// dodo-webhook/route.ts's deferred Webhooks() construction) — the check only
// runs the first time a request actually needs a Dodo client.

export type DodoEnvironment = "test_mode" | "live_mode";

function resolveDodoEnvironment(): DodoEnvironment {
  const raw = process.env.DODO_PAYMENTS_ENVIRONMENT;
  if (raw === "test_mode" || raw === "live_mode") return raw;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `[dodo] DODO_PAYMENTS_ENVIRONMENT must be "test_mode" or "live_mode" in production — ` +
        `got ${JSON.stringify(raw ?? null)}. Refusing to fall back to the SDK's own default ` +
        `(live_mode), which would silently create real checkout sessions.`
    );
  }
  // Local dev / CI / an unconfigured preview build: default to test_mode —
  // never live — so a missing var can never accidentally touch real money.
  return "test_mode";
}

let _environment: DodoEnvironment | null = null;

/** Resolved once per server process, not per request. */
export function getDodoEnvironment(): DodoEnvironment {
  if (_environment === null) _environment = resolveDodoEnvironment();
  return _environment;
}

/** bearerToken + environment for constructing a Dodo SDK client / calling createCheckoutSession. */
export function getDodoClientConfig(): { bearerToken: string; environment: DodoEnvironment } {
  const bearerToken = process.env.DODO_PAYMENTS_API_KEY;
  if (!bearerToken) {
    throw new Error("[dodo] DODO_PAYMENTS_API_KEY is not set — cannot create a Dodo Payments client");
  }
  return { bearerToken, environment: getDodoEnvironment() };
}
