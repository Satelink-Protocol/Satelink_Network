// Static egress declaration for the execution service (Stage 28, option 1).
//
// Broker keys (Binance ipRestrict, Upstox static IP) must be bound to ONE known public IP of the
// execution service, in a broker-permitted, non-US region (Binance geo-blocks US regions such as
// Railway us-west2). This module only DECLARES and validates that config; it provisions nothing.
//   TRADING_EXECUTION_EGRESS_IP     public IPv4 the execution service egresses from
//   TRADING_EXECUTION_REGION        hosting region id, e.g. "europe-west4" / "ap-southeast-1"
// assertEgressReady() is what a real (non-testnet) adapter must call before any signed request.
import { SecurityError } from './errors.mjs';

export const EgressStatus = Object.freeze({ NOT_PROVISIONED: 'NOT_PROVISIONED', INVALID: 'INVALID', DECLARED: 'DECLARED' });

/** Regions a Binance-bound execution service may not run in. */
export const BLOCKED_REGION_PATTERNS = Object.freeze([/^us[-_]/i, /(^|[-_])us(east|west|central)/i, /^ca[-_]/i]);

function privateOrReserved(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

export function egressConfig(env = process.env) {
  const ip = env.TRADING_EXECUTION_EGRESS_IP ?? '';
  const region = env.TRADING_EXECUTION_REGION ?? '';
  if (!ip && !region) return Object.freeze({ status: EgressStatus.NOT_PROVISIONED, ip: null, region: null, problems: ['no static egress IP or region declared'] });
  const problems = [];
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m || m.slice(1).some((o) => Number(o) > 255)) problems.push('TRADING_EXECUTION_EGRESS_IP must be a public IPv4 address');
  else if (privateOrReserved(ip)) problems.push('egress IP is private or reserved; brokers need the public egress IP');
  if (!region) problems.push('TRADING_EXECUTION_REGION is required');
  else if (BLOCKED_REGION_PATTERNS.some((r) => r.test(region))) problems.push(`region ${region} is not broker-permitted (US/CA regions are geo-blocked by Binance)`);
  return Object.freeze({ status: problems.length ? EgressStatus.INVALID : EgressStatus.DECLARED, ip: ip || null, region: region || null, problems });
}

export function assertEgressReady(env = process.env) {
  const c = egressConfig(env);
  if (c.status !== EgressStatus.DECLARED) throw new SecurityError('EGRESS_NOT_READY', c.problems.join('; '));
  return c;
}
