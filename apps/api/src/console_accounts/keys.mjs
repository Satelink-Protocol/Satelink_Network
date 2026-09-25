// Account ↔ API-key links (CONSOLE_ACCOUNTS_V1). Every key is referenced by
// api_credits.id; responses carry a fingerprint + hint, never the key — except
// the one response that creates it (create / rotate), which returns it once.
// Every mutation writes an account_audit row in the same transaction.
import crypto from 'node:crypto';
import { generateApiKey } from '../billing/credit_system.mjs';
import { TIER_DAILY_LIMIT } from '../billing/credit_service.mjs';

export const MAX_LIVE_KEYS_PER_ACCOUNT = 25;

export function fingerprint(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex');
}

/** "sk_free_…9f3a" — enough to recognise a key, useless to an attacker. */
export function keyHint(key) {
  const s = String(key);
  const prefix = s.startsWith('sk_') ? s.slice(0, s.indexOf('_', 3) + 1) : s.slice(0, 3);
  return `${prefix}…${s.slice(-4)}`;
}

export class AccountError extends Error {
  constructor(code, http, message, extra = {}) {
    super(message);
    this.code = code;
    this.http = http;
    this.extra = extra;
  }
}

async function tx(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function audit(client, accountId, action, subject, detail = {}) {
  await client.query(
    'INSERT INTO account_audit (account_id, action, subject, detail) VALUES ($1, $2, $3, $4)',
    [accountId, action, subject, JSON.stringify(detail)]
  );
}

const LIST_SQL = `
  SELECT l.api_key_id AS id, l.label, l.role, l.key_hint, l.key_fingerprint,
         l.created_at AS linked_at,
         c.tier, c.status, c.credits_usdt, c.daily_limit, c.last_used, c.created_at,
         al.paused, al.scopes, al.daily_cap_usdt
    FROM account_api_keys l
    JOIN api_credits c ON c.id = l.api_key_id
    LEFT JOIN agent_limits al ON al.api_key_id = l.api_key_id
   WHERE l.account_id = $1 AND l.revoked_at IS NULL
   ORDER BY l.created_at ASC`;

function shapeKey(r) {
  return {
    id: r.id,
    label: r.label,
    role: r.role,
    hint: r.key_hint,
    fingerprint: r.key_fingerprint.slice(0, 12),
    tier: r.tier,
    status: r.status,
    balanceUsdt: Number(r.credits_usdt ?? 0),
    dailyLimit: r.daily_limit,
    lastUsed: r.last_used,
    createdAt: r.created_at,
    linkedAt: r.linked_at,
    limits: { paused: Boolean(r.paused), scopes: r.scopes ?? null, dailyCapUsdt: r.daily_cap_usdt === null || r.daily_cap_usdt === undefined ? null : Number(r.daily_cap_usdt) },
  };
}

export async function listKeys(pool, accountId) {
  const r = await pool.query(LIST_SQL, [accountId]);
  return r.rows.map(shapeKey);
}

async function liveCount(client, accountId) {
  const r = await client.query('SELECT COUNT(*)::int AS n FROM account_api_keys WHERE account_id = $1 AND revoked_at IS NULL', [accountId]);
  return r.rows[0].n;
}

async function ownedLink(client, accountId, keyId, { lock = false } = {}) {
  const r = await client.query(
    `SELECT * FROM account_api_keys WHERE account_id = $1 AND api_key_id = $2 AND revoked_at IS NULL${lock ? ' FOR UPDATE' : ''}`,
    [accountId, keyId]
  );
  if (!r.rows[0]) throw new AccountError('key_not_found', 404, 'No such key on this account');
  return r.rows[0];
}

/** Issue a new free key bound to the account. Returns the key ONCE. */
export async function createKey(pool, accountId, { label = 'Untitled key', role = 'agent' } = {}) {
  return tx(pool, async (client) => {
    if ((await liveCount(client, accountId)) >= MAX_LIVE_KEYS_PER_ACCOUNT) {
      throw new AccountError('key_limit_reached', 409, `An account can hold ${MAX_LIVE_KEYS_PER_ACCOUNT} live keys`);
    }
    const apiKey = generateApiKey('free');
    const ins = await client.query(
      `INSERT INTO api_credits (api_key, tier, daily_limit, status) VALUES ($1, 'free', $2, 'active') RETURNING id`,
      [apiKey, TIER_DAILY_LIMIT.free]
    );
    const id = ins.rows[0].id;
    await client.query(
      `INSERT INTO account_api_keys (account_id, api_key_id, key_fingerprint, key_hint, label, role) VALUES ($1, $2, $3, $4, $5, $6)`,
      [accountId, id, fingerprint(apiKey), keyHint(apiKey), label, role]
    );
    await audit(client, accountId, 'key.create', String(id), { label, role });
    return { id, apiKey, hint: keyHint(apiKey), label, role };
  });
}

/**
 * Link an existing key. Possession is the proof: the caller presents the full
 * key once. A key already linked to another account is refused (the response
 * does not reveal which account). Linking a key you already own is a no-op.
 */
export async function linkKey(pool, accountId, { apiKey, label = 'Linked key', role = 'agent' } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.startsWith('sk_') || apiKey.length > 100) {
    throw new AccountError('invalid_key', 400, 'That does not look like a Satelink API key');
  }
  return tx(pool, async (client) => {
    const c = await client.query('SELECT id, status FROM api_credits WHERE api_key = $1 FOR UPDATE', [apiKey]);
    const row = c.rows[0];
    // Same response for "unknown" and "revoked": no key-existence oracle.
    if (!row || row.status !== 'active') throw new AccountError('invalid_key', 400, 'That key is not active');
    const existing = await client.query('SELECT account_id FROM account_api_keys WHERE api_key_id = $1 AND revoked_at IS NULL', [row.id]);
    if (existing.rows[0]) {
      if (existing.rows[0].account_id === accountId) return { id: row.id, hint: keyHint(apiKey), alreadyLinked: true };
      throw new AccountError('key_linked_elsewhere', 409, 'This key is already linked to another account');
    }
    if ((await liveCount(client, accountId)) >= MAX_LIVE_KEYS_PER_ACCOUNT) {
      throw new AccountError('key_limit_reached', 409, `An account can hold ${MAX_LIVE_KEYS_PER_ACCOUNT} live keys`);
    }
    await client.query(
      `INSERT INTO account_api_keys (account_id, api_key_id, key_fingerprint, key_hint, label, role) VALUES ($1, $2, $3, $4, $5, $6)`,
      [accountId, row.id, fingerprint(apiKey), keyHint(apiKey), label, role]
    );
    await audit(client, accountId, 'key.link', String(row.id), { label, role });
    return { id: row.id, hint: keyHint(apiKey), alreadyLinked: false };
  });
}

export async function renameKey(pool, accountId, keyId, label) {
  if (typeof label !== 'string' || !label.trim() || label.length > 80) {
    throw new AccountError('invalid_label', 400, 'Label must be 1–80 characters');
  }
  return tx(pool, async (client) => {
    const link = await ownedLink(client, accountId, keyId, { lock: true });
    await client.query('UPDATE account_api_keys SET label = $1 WHERE id = $2', [label.trim(), link.id]);
    await audit(client, accountId, 'key.rename', String(keyId), { from: link.label, to: label.trim() });
    return { id: keyId, label: label.trim() };
  });
}

/**
 * Revoke: the key stops working immediately — authorizeAndMeter refuses any
 * api_credits.status other than 'active' (403 account_inactive). The balance
 * stays on the revoked row; it is reported in the response so the console can
 * say so plainly.
 */
export async function revokeKey(pool, accountId, keyId) {
  return tx(pool, async (client) => {
    const link = await ownedLink(client, accountId, keyId, { lock: true });
    const c = await client.query(`UPDATE api_credits SET status = 'revoked' WHERE id = $1 RETURNING credits_usdt`, [keyId]);
    await client.query('UPDATE account_api_keys SET revoked_at = NOW() WHERE id = $1', [link.id]);
    await audit(client, accountId, 'key.revoke', String(keyId), { balance_left_usdt: c.rows[0]?.credits_usdt ?? null });
    return { id: keyId, revoked: true, balanceLeftUsdt: Number(c.rows[0]?.credits_usdt ?? 0) };
  });
}

async function tableExists(client, name) {
  const r = await client.query('SELECT to_regclass($1) AS t', [name]);
  return Boolean(r.rows[0].t);
}

/**
 * Rotate: issue a new secret for the same agent and retire the old one, in ONE
 * transaction with the old api_credits row locked:
 *   · the remaining credit balance moves to the new key (audited, exact),
 *   · the wallet binding moves too (wallet auth resolves the OLDEST row for a
 *     wallet — a revoked row keeping it would shadow the new key),
 *   · link label/role and agent limits move to the new key,
 *   · the old key is revoked.
 * Refused (409) when the key carries state that lives on the key string and
 * cannot move safely yet: an active plan entitlement, webhook subscriptions,
 * frozen funds or a payment hold. Revoke + create is the path for those.
 */
export async function rotateKey(pool, accountId, keyId) {
  return tx(pool, async (client) => {
    const link = await ownedLink(client, accountId, keyId, { lock: true });
    const old = (await client.query(
      `SELECT id, api_key, tier, daily_limit, credits_usdt, wallet_address, email, email_consent, status,
              COALESCE((to_jsonb(api_credits) ->> 'frozen_usdt')::numeric, 0) AS frozen_usdt,
              COALESCE((to_jsonb(api_credits) ->> 'payment_hold')::boolean, false) AS payment_hold
         FROM api_credits WHERE id = $1 FOR UPDATE`,
      [keyId]
    )).rows[0];
    if (!old || old.status !== 'active') throw new AccountError('key_inactive', 409, 'Only an active key can be rotated');
    if (old.payment_hold) throw new AccountError('rotate_blocked', 409, 'This key is on a payment hold — contact support', { reason: 'payment_hold' });
    if (Number(old.frozen_usdt) > 0) throw new AccountError('rotate_blocked', 409, 'This key has frozen funds — contact support', { reason: 'frozen_funds' });
    if (await tableExists(client, 'plan_entitlements')) {
      const e = await client.query('SELECT 1 FROM plan_entitlements WHERE api_key = $1 AND (period_end IS NULL OR period_end > NOW()) LIMIT 1', [old.api_key]);
      if (e.rowCount) throw new AccountError('rotate_blocked', 409, 'This key has an active plan — revoke and create a new key after the plan moves to your account', { reason: 'active_plan' });
    }
    if (await tableExists(client, 'webhook_subscriptions')) {
      const w = await client.query(`SELECT 1 FROM webhook_subscriptions WHERE api_key = $1 AND COALESCE(status, 'active') = 'active' LIMIT 1`, [old.api_key]);
      if (w.rowCount) throw new AccountError('rotate_blocked', 409, 'This key has webhook subscriptions — remove them first', { reason: 'webhooks' });
    }

    const newKey = generateApiKey(old.tier || 'free');
    const moved = old.credits_usdt;
    const ins = await client.query(
      `INSERT INTO api_credits (api_key, tier, daily_limit, wallet_address, status, email, email_consent, credits_usdt)
       VALUES ($1, $2, $3, $4, 'active', $5, $6, $7) RETURNING id`,
      [newKey, old.tier, old.daily_limit, old.wallet_address, old.email, old.email_consent ?? false, moved]
    );
    const newId = ins.rows[0].id;
    await client.query(`UPDATE api_credits SET credits_usdt = 0, status = 'revoked', wallet_address = NULL WHERE id = $1`, [old.id]);
    await client.query('UPDATE account_api_keys SET revoked_at = NOW() WHERE id = $1', [link.id]);
    await client.query(
      `INSERT INTO account_api_keys (account_id, api_key_id, key_fingerprint, key_hint, label, role) VALUES ($1, $2, $3, $4, $5, $6)`,
      [accountId, newId, fingerprint(newKey), keyHint(newKey), link.label, link.role]
    );
    await client.query('UPDATE agent_limits SET api_key_id = $1, updated_at = NOW() WHERE api_key_id = $2', [newId, old.id]);
    await audit(client, accountId, 'key.rotate', String(old.id), {
      to_key_id: newId,
      moved_credits_usdt: String(moved),
      moved_wallet: Boolean(old.wallet_address),
    });
    return { id: newId, apiKey: newKey, hint: keyHint(newKey), replacedId: old.id, movedCreditsUsdt: Number(moved) };
  });
}

/**
 * Idempotency for create/rotate (money-adjacent). The first response for an
 * (account, Idempotency-Key) pair is stored; a replay returns it verbatim
 * instead of issuing a second key / moving a balance twice. Two concurrent
 * first attempts: the loser's INSERT conflicts and it returns the winner's
 * stored response once available.
 */
export async function withIdempotency(pool, accountId, idemKey, action, fn) {
  if (!idemKey) return fn();
  if (typeof idemKey !== 'string' || idemKey.length > 128) {
    throw new AccountError('invalid_idempotency_key', 400, 'Idempotency-Key must be ≤128 characters');
  }
  const prior = await pool.query('SELECT action, status, response FROM account_idempotency WHERE account_id = $1 AND idem_key = $2', [accountId, idemKey]);
  if (prior.rows[0]) {
    if (prior.rows[0].action !== action) throw new AccountError('idempotency_key_reused', 422, 'That Idempotency-Key was used for a different action');
    if (prior.rows[0].status === 0) throw new AccountError('idempotency_in_progress', 409, 'A request with this Idempotency-Key is in progress — retry shortly');
    return { replayed: true, status: prior.rows[0].status, body: prior.rows[0].response };
  }
  // Claim the key first so a concurrent duplicate cannot run fn() too.
  const claim = await pool.query(
    `INSERT INTO account_idempotency (account_id, idem_key, action, status, response) VALUES ($1, $2, $3, 0, '{}'::jsonb)
     ON CONFLICT DO NOTHING RETURNING 1`,
    [accountId, idemKey, action]
  );
  if (!claim.rowCount) throw new AccountError('idempotency_in_progress', 409, 'A request with this Idempotency-Key is in progress — retry shortly');
  try {
    const out = await fn();
    await pool.query('UPDATE account_idempotency SET status = $3, response = $4 WHERE account_id = $1 AND idem_key = $2', [accountId, idemKey, out.status, JSON.stringify(out.body)]);
    return out;
  } catch (err) {
    // A failed attempt does not burn the key: release it so the client can retry.
    await pool.query('DELETE FROM account_idempotency WHERE account_id = $1 AND idem_key = $2 AND status = 0', [accountId, idemKey]);
    throw err;
  }
}
