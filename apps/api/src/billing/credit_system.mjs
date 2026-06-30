/**
 * Credit System — PostgreSQL persistence for API usage
 * Bridges metered revenue to collected revenue tracking
 */

import crypto from 'crypto';

const PRICE_PER_CALL_USDT = 0.000030;

const TIERS = {
  free:       { daily_limit: 500,       price_usdt: 0 },
  basic:      { daily_limit: 10000,     price_usdt: 9 },
  pro:        { daily_limit: 100000,    price_usdt: 49 },
  enterprise: { daily_limit: 1000000,   price_usdt: 199 },
};

export function generateApiKey(tier = 'free') {
  const prefix = tier === 'free' ? 'sk_free' :
                 tier === 'basic' ? 'sk_basic' :
                 tier === 'pro' ? 'sk_pro' : 'sk_ent';
  return `${prefix}_${crypto.randomBytes(24).toString('hex')}`;
}

// Conservative single-address email validation. Returns the normalised
// (trimmed, lower-cased) address, or null if the input is not a usable email.
// Used to gate what we persist for outreach — we never store junk we would
// later try to send mail to.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function normaliseEmail(raw) {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  return EMAIL_RE.test(email) ? email : null;
}

export async function ensureCreditTables(pool) {
  if (!pool) return;

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS api_credits (
        id              SERIAL PRIMARY KEY,
        api_key         VARCHAR(100) UNIQUE NOT NULL,
        tier            VARCHAR(20) DEFAULT 'free',
        daily_limit     INTEGER DEFAULT 500,
        credits_usdt    NUMERIC(18,6) DEFAULT 0,
        total_deposited NUMERIC(18,6) DEFAULT 0,
        total_spent     NUMERIC(18,6) DEFAULT 0,
        wallet_address  VARCHAR(42),
        created_at      TIMESTAMP DEFAULT NOW(),
        last_used       TIMESTAMP,
        status          VARCHAR(20) DEFAULT 'active'
      )
    `);

    // Email collection — opt-in contact for product/outreach communication.
    // Added via ALTER so existing api_credits rows (keys created before this
    // surface) gain the columns without a destructive migration. `email_consent`
    // gates marketing/outreach use; a stored email with consent=false is for
    // transactional contact only and must NOT be used for cold outreach.
    await pool.query(`ALTER TABLE api_credits ADD COLUMN IF NOT EXISTS email VARCHAR(254)`);
    await pool.query(`ALTER TABLE api_credits ADD COLUMN IF NOT EXISTS email_consent BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE api_credits ADD COLUMN IF NOT EXISTS email_captured_at TIMESTAMPTZ`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS api_usage_daily (
        id          SERIAL PRIMARY KEY,
        api_key     VARCHAR(100) NOT NULL,
        date        DATE DEFAULT CURRENT_DATE,
        request_count INTEGER DEFAULT 0,
        usdt_spent  NUMERIC(18,6) DEFAULT 0,
        UNIQUE(api_key, date)
      )
    `);

    // Deposit ledger — ensured at startup so GET /api/keys/deposits never 500s
    // on a DB that has not yet recorded a deposit (was previously created lazily
    // inside POST /deposit only).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS api_deposits (
        id          SERIAL PRIMARY KEY,
        api_key     VARCHAR(100) NOT NULL,
        tx_hash     VARCHAR(66) UNIQUE NOT NULL,
        amount_usdt NUMERIC(18,6) NOT NULL,
        from_address VARCHAR(42),
        tier_before VARCHAR(20),
        tier_after  VARCHAR(20),
        created_at  TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_api_credits_key ON api_credits(api_key)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_api_usage_key_date ON api_usage_daily(api_key, date)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_api_deposits_key ON api_deposits(api_key)`);
    // Fast lookup of outreach-eligible contacts (opted-in, non-null email).
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_api_credits_outreach ON api_credits(email_consent) WHERE email IS NOT NULL`);

    console.log('[CreditSystem] Tables ensured');
  } catch (err) {
    console.error('[CreditSystem] Table creation failed:', err.message);
  }
}

export async function createApiKeyWithCredits(pool, tier = 'free', walletAddress = null, opts = {}) {
  if (!TIERS[tier]) {
    throw new Error(`Invalid tier: ${tier}`);
  }

  const apiKey = generateApiKey(tier);
  const { daily_limit } = TIERS[tier];

  // Email is optional and pre-validated by the caller (normaliseEmail).
  const email = opts.email || null;
  const emailConsent = email ? Boolean(opts.emailConsent) : false;
  const capturedAt = email ? new Date() : null;

  try {
    await pool.query(`
      INSERT INTO api_credits (api_key, tier, daily_limit, wallet_address, status, email, email_consent, email_captured_at)
      VALUES ($1, $2, $3, $4, 'active', $5, $6, $7)
    `, [apiKey, tier, daily_limit, walletAddress, email, emailConsent, capturedAt]);

    console.log(`[CreditSystem] Created key: ${apiKey.slice(0, 15)}... tier=${tier}${email ? ` email=yes consent=${emailConsent}` : ''}`);

    return {
      api_key: apiKey,
      tier,
      daily_limit,
      credits_usdt: 0,
      status: 'active',
      email_captured: Boolean(email),
    };
  } catch (err) {
    console.error('[CreditSystem] Key creation failed:', err.message);
    throw err;
  }
}

/**
 * Attach or update the opt-in contact email for an existing key.
 * Lets the ~16 free keys created before email collection opt in later.
 * `email` must already be normalised (normaliseEmail) by the caller.
 * Returns true if a row was updated, false if the key was not found.
 */
export async function setKeyEmail(pool, apiKey, email, emailConsent = false) {
  const result = await pool.query(`
    UPDATE api_credits
       SET email = $1,
           email_consent = $2,
           email_captured_at = NOW()
     WHERE api_key = $3
  `, [email, Boolean(emailConsent), apiKey]);
  return result.rowCount > 0;
}

export async function getKeyCredits(pool, apiKey) {
  try {
    const result = await pool.query(
      'SELECT tier, daily_limit, credits_usdt, status FROM api_credits WHERE api_key = $1',
      [apiKey]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error('[CreditSystem] Get credits failed:', err.message);
    return null;
  }
}

export async function getDailyUsage(pool, apiKey, date = null) {
  const targetDate = date || new Date().toISOString().slice(0, 10);

  try {
    const result = await pool.query(
      'SELECT request_count, usdt_spent FROM api_usage_daily WHERE api_key = $1 AND date = $2',
      [apiKey, targetDate]
    );
    return result.rows[0] || { request_count: 0, usdt_spent: 0 };
  } catch (err) {
    console.error('[CreditSystem] Get usage failed:', err.message);
    return { request_count: 0, usdt_spent: 0 };
  }
}

export async function incrementDailyUsage(pool, apiKey) {
  const today = new Date().toISOString().slice(0, 10);

  try {
    await pool.query(`
      INSERT INTO api_usage_daily (api_key, date, request_count, usdt_spent)
      VALUES ($1, $2, 1, $3)
      ON CONFLICT (api_key, date) DO UPDATE
      SET request_count = api_usage_daily.request_count + 1,
          usdt_spent = api_usage_daily.usdt_spent + $3
    `, [apiKey, today, PRICE_PER_CALL_USDT]);

    await pool.query(
      'UPDATE api_credits SET last_used = NOW(), total_spent = total_spent + $1 WHERE api_key = $2',
      [PRICE_PER_CALL_USDT, apiKey]
    );
  } catch (err) {
    console.warn('[CreditSystem] Usage update failed:', err.message);
  }
}

export async function getKeyUsageSummary(pool, apiKey) {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const [keyInfo, usage] = await Promise.all([
      pool.query('SELECT tier, daily_limit, credits_usdt, total_spent, status, created_at FROM api_credits WHERE api_key = $1', [apiKey]),
      pool.query('SELECT request_count, usdt_spent FROM api_usage_daily WHERE api_key = $1 AND date = $2', [apiKey, today]),
    ]);

    if (!keyInfo.rows[0]) {
      return null;
    }

    const k = keyInfo.rows[0];
    const u = usage.rows[0] || { request_count: 0, usdt_spent: 0 };

    return {
      tier: k.tier,
      daily_limit: k.daily_limit,
      requests_today: u.request_count,
      requests_remaining: Math.max(0, k.daily_limit - u.request_count),
      usdt_spent_today: parseFloat(u.usdt_spent || 0),
      total_spent_usdt: parseFloat(k.total_spent || 0),
      credits_remaining: parseFloat(k.credits_usdt || 0),
      status: k.status,
      created_at: k.created_at,
    };
  } catch (err) {
    console.error('[CreditSystem] Usage summary failed:', err.message);
    return null;
  }
}

export { TIERS, PRICE_PER_CALL_USDT };
