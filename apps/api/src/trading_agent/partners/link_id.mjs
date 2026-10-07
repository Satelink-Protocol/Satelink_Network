// Binance Link ID configuration (Stage 32). The value is entered by the founder into the secret store
// under BINANCE_LINK_ID_SECRET and is never committed; git holds only its fingerprint (tracker item
// link_id). The adapter adds the "x-" prefix itself (brokers/binance/mapping.mjs linkPrefix).
// Production use needs the tracker to say PARTNER_APPROVED with a matching fingerprint; production is
// also refused while LIVE_TRADING is locked (brokers/binance/config.mjs).
import { createHash } from 'node:crypto';
import { LINK_ID_RE } from '../brokers/binance/config.mjs';
import { BrokerError, BrokerErrorCode } from '../brokers/errors.mjs';

export const BINANCE_LINK_ID_SECRET = 'TRADING_BINANCE_LINK_ID';

/** Consistency fingerprint (not secrecy: Link IDs are short identifiers, not credentials). */
export function linkIdFingerprint(linkId) {
  return createHash('sha256').update(`satelink-binance-link-id:${linkId}`).digest('hex').slice(0, 16);
}

/** Validate a Link ID value without echoing it. Returns a list of problems (empty = valid). */
export function linkIdProblems(value) {
  if (value === undefined || value === null || value === '') return ['not set'];
  if (typeof value !== 'string') return ['must be a string'];
  if (/^x-/i.test(value)) return ['enter the Link ID without the "x-" prefix; the adapter adds it'];
  if (value !== value.trim()) return ['contains leading or trailing whitespace'];
  if (!LINK_ID_RE.test(value)) return ['must be 4–16 ASCII letters or digits'];
  return [];
}

const fail = (code, message) => new BrokerError(code, { venue: 'binance', message });

/**
 * Resolve the Link ID for an environment.
 * @param secrets   secret store with async get(name) → string | undefined (founder-entered)
 * @param environment 'testnet' | 'production'
 * @param partner   the Binance entry of the partner tracker (required for production)
 */
export async function resolveBinanceLinkId({ secrets, environment, partner = null }) {
  if (!secrets || typeof secrets.get !== 'function') throw fail(BrokerErrorCode.INVALID_REQUEST, 'a secret store is required for the Binance Link ID');
  const value = await secrets.get(BINANCE_LINK_ID_SECRET);
  const problems = linkIdProblems(value);
  if (problems.length) throw fail(BrokerErrorCode.INVALID_REQUEST, `${BINANCE_LINK_ID_SECRET}: ${problems.join('; ')}`);
  if (environment === 'testnet') return value;
  if (environment !== 'production') throw fail(BrokerErrorCode.INVALID_REQUEST, `unknown Binance environment ${environment}`);
  if (partner?.state !== 'PARTNER_APPROVED') throw fail(BrokerErrorCode.PERMISSION_DENIED, 'Binance production Link ID refused: the partner tracker is not PARTNER_APPROVED');
  const item = (partner.items ?? []).find((i) => i.id === 'link_id');
  if (item?.status !== 'EVIDENCED' || item.linkIdFingerprint !== linkIdFingerprint(value)) throw fail(BrokerErrorCode.PERMISSION_DENIED, `${BINANCE_LINK_ID_SECRET} does not match the evidenced Link ID fingerprint`);
  return value;
}
