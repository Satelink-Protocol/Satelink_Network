/**
 * Pure, side-effect-free validators for the API-key deposit/crediting flow.
 *
 * Extracted from api_keys_route.mjs so the security-critical checks
 * (sender↔wallet ownership binding and confirmation depth) can be unit-tested
 * without a live chain or a database connection.
 */

// Polygon reorgs are usually shallow, but crediting USDT balance is
// irreversible, so require a safe confirmation depth before issuing credit.
// Requirement: 20–30 minimum.
export const MIN_CONFIRMATIONS = 25;

const KEY_PREFIXES = ['sk_free', 'sk_basic', 'sk_pro', 'sk_ent', 'sk_live'];

/**
 * Read the API key from a secure transport (X-API-Key header, or request body)
 * instead of the URL path — so the bearer secret never lands in access logs,
 * proxy logs, browser history, or Referer headers.
 */
export function extractApiKey(req) {
  const fromHeader = typeof req.get === 'function'
    ? req.get('X-API-Key')
    : (req.headers && (req.headers['x-api-key'] || req.headers['X-API-Key']));
  const fromBody = req.body && req.body.api_key;
  return String(fromHeader || fromBody || '').trim();
}

/** True when the key has one of the recognised tier prefixes. */
export function isValidKeyFormat(key) {
  return typeof key === 'string' && KEY_PREFIXES.some((p) => key.startsWith(p));
}

/**
 * Ownership binding for deposit crediting: the on-chain sender MUST equal the
 * wallet registered to the API key. A registered wallet is mandatory — a key
 * with no wallet on file cannot be credited (prevents deposit hijacking where
 * any treasury-bound transaction is claimed by an unrelated key).
 *
 * @returns {{ok: true} | {ok: false, code: string, error: string}}
 */
export function checkDepositOwnership(fromAddress, walletAddress) {
  if (!walletAddress || String(walletAddress).trim() === '') {
    return {
      ok: false,
      code: 'wallet_not_registered',
      error: 'This API key has no registered funding wallet. Register the wallet that will send the deposit before crediting.',
    };
  }
  if (!fromAddress || String(fromAddress).trim() === '') {
    return {
      ok: false,
      code: 'sender_unknown',
      error: 'Could not determine the deposit sender address from the transaction.',
    };
  }
  if (String(fromAddress).toLowerCase() !== String(walletAddress).toLowerCase()) {
    return {
      ok: false,
      code: 'wallet_mismatch',
      error: 'Deposit sender does not match the wallet registered to this API key.',
    };
  }
  return { ok: true };
}

/** Confirmations a receipt has, given the current chain head. */
export function confirmationCount(currentBlock, receiptBlock) {
  return currentBlock - receiptBlock + 1;
}

/** Confirmation-depth gate. Block numbers in, boolean out. */
export function hasEnoughConfirmations(currentBlock, receiptBlock, min = MIN_CONFIRMATIONS) {
  if (!Number.isFinite(currentBlock) || !Number.isFinite(receiptBlock)) return false;
  return confirmationCount(currentBlock, receiptBlock) >= min;
}
