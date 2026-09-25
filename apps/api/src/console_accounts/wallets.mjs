// Wallet links (SIWE-style, EIP-4361 message format) + the per-wallet x402
// view (CONSOLE_ACCOUNTS_V1).
//
// Linking proves control: the server issues a one-time nonce bound to the
// account, the wallet signs the exact message, the server checks the
// signature, nonce, domain, URI and expiry, then stores the lower-cased
// address. Signing moves no funds and grants no spending rights.
import crypto from 'node:crypto';
import { verifyMessage } from 'ethers';
import { AccountError } from './keys.mjs';

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const NONCE_TTL_MIN = 10;
export const SIWE_DOMAIN = 'console.satelink.network';
export const SIWE_URI = 'https://console.satelink.network';
const ALLOWED_CHAINS = new Set([137, 8453]); // Polygon (USDT rail), Base (x402)

export function buildMessage({ address, chainId, nonce, issuedAt, expiresAt }) {
  return [
    `${SIWE_DOMAIN} wants you to sign in with your Ethereum account:`,
    address,
    '',
    'Link this wallet to your Satelink account. Signing does not move funds or grant spending rights.',
    '',
    `URI: ${SIWE_URI}`,
    'Version: 1',
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    `Expiration Time: ${expiresAt}`,
  ].join('\n');
}

export function parseMessage(message) {
  if (typeof message !== 'string' || message.length > 2000) return null;
  const lines = message.split('\n');
  const field = (name) => lines.find((l) => l.startsWith(`${name}: `))?.slice(name.length + 2);
  const m = {
    domain: lines[0]?.replace(' wants you to sign in with your Ethereum account:', ''),
    address: lines[1],
    uri: field('URI'),
    chainId: Number(field('Chain ID')),
    nonce: field('Nonce'),
    expiresAt: field('Expiration Time'),
  };
  return m.address && m.nonce ? m : null;
}

export async function createChallenge(pool, accountId, { address, chainId = 8453 } = {}) {
  if (!ADDR.test(address || '')) throw new AccountError('invalid_address', 400, 'Not an Ethereum address');
  if (!ALLOWED_CHAINS.has(Number(chainId))) throw new AccountError('invalid_chain', 400, 'Chain must be Polygon (137) or Base (8453)');
  const nonce = crypto.randomBytes(16).toString('hex');
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + NONCE_TTL_MIN * 60_000);
  await pool.query('INSERT INTO account_siwe_nonces (nonce, account_id, expires_at) VALUES ($1, $2, $3)', [nonce, accountId, expiresAt]);
  return { message: buildMessage({ address, chainId: Number(chainId), nonce, issuedAt: issuedAt.toISOString(), expiresAt: expiresAt.toISOString() }), nonce, expiresAt };
}

export async function verifyAndLink(pool, accountId, { message, signature } = {}) {
  const m = parseMessage(message);
  if (!m) throw new AccountError('invalid_message', 400, 'Message is not a Satelink wallet-link message');
  if (m.domain !== SIWE_DOMAIN || m.uri !== SIWE_URI) throw new AccountError('invalid_message', 400, 'Message was issued for a different site');
  if (!ADDR.test(m.address) || !ALLOWED_CHAINS.has(m.chainId)) throw new AccountError('invalid_message', 400, 'Message has a bad address or chain');

  let recovered;
  try {
    recovered = verifyMessage(message, signature);
  } catch {
    throw new AccountError('bad_signature', 400, 'Signature could not be verified');
  }
  if (recovered.toLowerCase() !== m.address.toLowerCase()) throw new AccountError('bad_signature', 400, 'Signature does not match the wallet');

  // Consume the nonce atomically: only an unused, unexpired nonce issued to
  // THIS account works, and it works once.
  const used = await pool.query(
    `UPDATE account_siwe_nonces SET used_at = NOW()
      WHERE nonce = $1 AND account_id = $2 AND used_at IS NULL AND expires_at > NOW()
      RETURNING nonce`,
    [m.nonce, accountId]
  );
  if (!used.rowCount) throw new AccountError('nonce_invalid', 400, 'This link request expired or was already used — start again');

  const address = m.address.toLowerCase();
  const ins = await pool.query(
    `INSERT INTO account_wallets (account_id, address, chain_id) VALUES ($1, $2, $3)
     ON CONFLICT (address) DO NOTHING RETURNING id`,
    [accountId, address, m.chainId]
  );
  if (!ins.rowCount) {
    const owner = await pool.query('SELECT account_id FROM account_wallets WHERE address = $1', [address]);
    if (owner.rows[0]?.account_id !== accountId) throw new AccountError('wallet_linked_elsewhere', 409, 'This wallet is linked to another account');
  }
  await pool.query('INSERT INTO account_audit (account_id, action, subject, detail) VALUES ($1, $2, $3, $4)', [accountId, 'wallet.link', address, JSON.stringify({ chain_id: m.chainId })]);
  return { address, chainId: m.chainId };
}

export async function listWallets(pool, accountId) {
  const r = await pool.query('SELECT address, chain_id, verified_at FROM account_wallets WHERE account_id = $1 ORDER BY verified_at', [accountId]);
  return r.rows.map((w) => ({ address: w.address, chainId: w.chain_id, verifiedAt: w.verified_at }));
}

export async function unlinkWallet(pool, accountId, address) {
  const r = await pool.query('DELETE FROM account_wallets WHERE account_id = $1 AND address = $2', [accountId, String(address).toLowerCase()]);
  if (!r.rowCount) throw new AccountError('not_found', 404, 'No such wallet on this account');
  await pool.query('INSERT INTO account_audit (account_id, action, subject) VALUES ($1, $2, $3)', [accountId, 'wallet.unlink', String(address).toLowerCase()]);
  return { address: String(address).toLowerCase(), unlinked: true };
}

async function tableExists(pool, name) {
  const r = await pool.query('SELECT to_regclass($1) AS t', [name]);
  return Boolean(r.rows[0].t);
}

/**
 * x402 for one linked wallet. Settled payments are per wallet
 * (payment_sources.payer). 402 challenges are NOT attributable to a wallet —
 * the payer is unknown when a challenge is issued — so they are returned as
 * network-wide daily counts, labelled as such, never as this wallet's.
 */
export async function x402ForWallet(pool, accountId, address, { days = 30 } = {}) {
  const addr = String(address || '').toLowerCase();
  const owned = await pool.query('SELECT 1 FROM account_wallets WHERE account_id = $1 AND address = $2', [accountId, addr]);
  if (!owned.rowCount) throw new AccountError('not_found', 404, 'Link this wallet first');
  const d = Math.min(Math.max(parseInt(days, 10) || 30, 1), 90);

  const settled = (await tableExists(pool, 'payment_sources'))
    ? (await pool.query(
        `SELECT created_at, amount_usd, token, network, tx_hash, is_test_data
           FROM payment_sources
          WHERE source = 'x402' AND lower(payer) = $1 AND created_at >= NOW() - ($2 || ' days')::interval
          ORDER BY created_at DESC LIMIT 200`,
        [addr, String(d)]
      )).rows.map((p) => ({ at: p.created_at, amountUsd: Number(p.amount_usd), token: p.token, network: p.network, txHash: p.tx_hash, test: Boolean(p.is_test_data) }))
    : [];

  const challenges = (await tableExists(pool, 'x402_funnel_daily'))
    ? (await pool.query(
        `SELECT day, x402_402_served AS served, x_payment_retry_received AS retries, x402_settled AS settled
           FROM x402_funnel_daily WHERE day >= CURRENT_DATE - $1::int ORDER BY day DESC`,
        [d]
      )).rows.map((r) => ({ day: r.day, challengesServed: Number(r.served), paymentRetries: Number(r.retries), settled: Number(r.settled) }))
    : [];

  return {
    wallet: addr,
    days: d,
    settled: { scope: 'this_wallet', count: settled.length, totalUsd: settled.reduce((a, p) => a + p.amountUsd, 0), items: settled },
    challenges: { scope: 'network_wide', note: 'A 402 challenge is issued before the payer is known, so challenges cannot be attributed to a wallet.', daily: challenges },
  };
}
