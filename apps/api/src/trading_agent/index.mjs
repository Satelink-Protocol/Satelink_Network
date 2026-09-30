// Trading agent module (Stage 09 foundation). See ./README.md.
//
// NOT MOUNTED: apps/api/app_factory.mjs does not import this module. A later
// stage wires it in by calling mountTradingRoutes(app, deps), which is itself a
// no-op unless TRADING_FLAG_TRADING_AGENT === 'true'. Nothing here touches the
// RPC, billing, ledger or settlement paths.
import { Router } from 'express';
import { isTradingFlagEnabled, tradingFlagSnapshot, TRADING_FLAGS, LOCKED_TRADING_FLAGS } from './flags.mjs';
import * as brokers from './brokers/index.mjs';
import * as credentials from './credentials/index.mjs';
import * as strategies from './strategies/index.mjs';
import * as signals from './signals/index.mjs';
import * as risk from './risk/index.mjs';
import * as mandates from './mandates/index.mjs';
import * as orders from './orders/index.mjs';
import * as execution from './execution/index.mjs';
import * as positions from './positions/index.mjs';
import * as outbox from './outbox/index.mjs';
import * as audit from './audit/index.mjs';

export { isTradingFlagEnabled, tradingFlagSnapshot, TRADING_FLAGS, LOCKED_TRADING_FLAGS };

export const SUBDOMAINS = Object.freeze([
  brokers, credentials, strategies, signals, risk, mandates, orders, execution, positions, outbox, audit,
]);

/** Every table owned by the trading module (must match migration 021). */
export const TRADING_TABLES = Object.freeze(SUBDOMAINS.flatMap((d) => d.TABLES));

export const TRADING_MOUNT_PATH = '/v1/trading';

/**
 * Router with a single read-only diagnostic route. Exposes flag names and
 * booleans only — no data, no secrets.
 */
export function createTradingRouter({ env = process.env } = {}) {
  const router = Router();
  router.get('/status', (_req, res) => {
    res.json({ ok: true, data: { flags: tradingFlagSnapshot(env), subdomains: SUBDOMAINS.map((d) => d.DOMAIN) } });
  });
  return router;
}

/**
 * Mount the trading routes only when TRADING_AGENT is enabled.
 * @returns {{mounted: boolean, reason?: string}}
 */
export function mountTradingRoutes(app, { env = process.env } = {}) {
  if (!isTradingFlagEnabled('TRADING_AGENT', env)) {
    return { mounted: false, reason: 'TRADING_AGENT flag is off' };
  }
  app.use(TRADING_MOUNT_PATH, createTradingRouter({ env }));
  return { mounted: true };
}
