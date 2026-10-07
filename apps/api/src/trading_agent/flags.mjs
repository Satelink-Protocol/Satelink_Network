// Trading-agent feature flags (Stage 09). ALL default OFF.
//
// Same mechanism as the existing server flags (e.g. console_accounts/flag.mjs):
// read from process.env at call time, enabled only by the exact string 'true',
// so a Railway env flip takes effect on the restart it triggers.
//
// Env names are prefixed TRADING_FLAG_ so they cannot collide with existing
// variables (SATELINK_SUBSCRIPTIONS_ENABLED, the services/revenue-engine
// package, …).
//
// LOCKED flags cannot be enabled by environment at all: isTradingFlagEnabled()
// returns false for them whatever the env says. Unlocking one is a code change
// (remove it from LOCKED_TRADING_FLAGS) that needs FOUNDER REVIEW, a staging
// environment and the Gate 0 blockers cleared (docs/trading-agent/audit/08-deploy.md §8).

export const TRADING_FLAGS = Object.freeze([
  'TRADING_AGENT',     // master switch: trading module / routes
  'BINANCE',           // Binance connector
  'UPSTOX_COPILOT',    // Upstox, human-approved orders
  'UPSTOX_AUTOMATED',  // Upstox, automated orders            (LOCKED)
  'ALPACA',            // Alpaca connector
  'LIVE_TRADING',      // any live (non-paper) order            (LOCKED)
  'LIVE_SMALL',        // capped live pilot
  'BYOK',              // bring-your-own broker keys
  'MCP_TRADING',       // trading tools exposed over MCP
  'AUTONOMOUS_MODE',   // agent acts without per-order approval (LOCKED)
  'REVENUE_ENGINE',    // trading fees / revenue booking
  'SUBSCRIPTIONS',     // trading subscriptions
  'MANDATE_MODE_B',    // agent / machine proposals under a human-signed Mode B mandate (paper unless LIVE_TRADING)
]);

export const LOCKED_TRADING_FLAGS = Object.freeze(new Set([
  'LIVE_TRADING',
  'AUTONOMOUS_MODE',
  'UPSTOX_AUTOMATED',
]));

export const TRADING_FLAG_ENV_PREFIX = 'TRADING_FLAG_';

/** Environment variable name that backs a flag, e.g. TRADING_FLAG_BINANCE. */
export function tradingFlagEnvName(flag) {
  assertKnownFlag(flag);
  return `${TRADING_FLAG_ENV_PREFIX}${flag}`;
}

/**
 * True only when the flag is known, not locked, and its env var is exactly 'true'.
 * @param {string} flag one of TRADING_FLAGS
 * @param {Record<string, string|undefined>} [env] defaults to process.env
 */
export function isTradingFlagEnabled(flag, env = process.env) {
  assertKnownFlag(flag);
  if (LOCKED_TRADING_FLAGS.has(flag)) return false;
  return env[tradingFlagEnvName(flag)] === 'true';
}

/** Snapshot of every flag for diagnostics (no secrets; names and booleans only). */
export function tradingFlagSnapshot(env = process.env) {
  return Object.fromEntries(
    TRADING_FLAGS.map((flag) => [flag, {
      enabled: isTradingFlagEnabled(flag, env),
      locked: LOCKED_TRADING_FLAGS.has(flag),
      requested: env[tradingFlagEnvName(flag)] === 'true',
    }]),
  );
}

function assertKnownFlag(flag) {
  if (!TRADING_FLAGS.includes(flag)) {
    throw new Error(`Unknown trading flag: ${flag}`);
  }
}
