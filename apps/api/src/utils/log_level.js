/**
 * Lightweight log-level gate for hot-path logging.
 *
 * Usage:
 *   import { isDebug } from '../utils/log_level.js';
 *   if (isDebug) console.log('[MyModule] ...');
 *
 * Set LOG_LEVEL=debug in .env to enable verbose output.
 * Default in production: 'warn' (suppresses info/debug).
 */

const LEVEL = (process.env.LOG_LEVEL || 'warn').toLowerCase();

export const isDebug = LEVEL === 'debug';
export const isInfo  = isDebug || LEVEL === 'info';
export const isWarn  = isInfo  || LEVEL === 'warn';
