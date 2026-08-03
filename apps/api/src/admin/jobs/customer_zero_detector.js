/**
 * Customer Zero Detector
 * Polls credit_deposits for the first deposit from a non-founder wallet.
 * Fires a Discord alert once (idempotent via automation_logs).
 *
 * Corrected vs the original design doc:
 *   - `pool` is a pg Pool: pool.query() returns { rows }
 *   - credit_deposits real columns: wallet_address, amount_usdt, tx_hash,
 *     block_number, chain_id, confirmed_at (timestamped deposit confirmation)
 *   - Removed the hardcoded "Runway after refund: 47 days" line — that number
 *     is not computed from anything, and per docs/audit-2026-06-13 real external
 *     revenue is $0. The alert states only what is actually known: the deposit.
 */

// Founder/team wallets to exclude from "first external deposit" detection.
// Sourced from env only (comma-separated) — no hardcoded addresses in source.
// If unset, the filter is empty and ANY deposit can trigger the alert, so set
// FOUNDER_WALLETS in the API env to avoid a false Customer Zero on a team deposit.
const FOUNDER_WALLETS = (process.env.FOUNDER_WALLETS || '')
  .split(',')
  .map(w => w.trim().toLowerCase())
  .filter(Boolean);

export class CustomerZeroDetector {
  constructor(pool) { this.pool = pool; }

  async q(sql, params) {
    const r = await this.pool.query(sql, params);
    return r.rows;
  }

  async run() {
    const result = await this.checkDeposits();
    if (result.found && !result.alreadyFired) {
      await this.fireAlert(result.deposit);
    }
    return result;
  }

  async checkDeposits() {
    let deposits = [];
    try {
      deposits = await this.q(
        `SELECT wallet_address, amount_usdt, tx_hash, confirmed_at AS created_at
           FROM credit_deposits
          WHERE LOWER(wallet_address) != ALL($1::text[])
            AND amount_usdt > 0
          ORDER BY confirmed_at DESC
          LIMIT 5`,
        [FOUNDER_WALLETS]
      );
    } catch (e) {
      // Fallback if credit_deposits is unavailable — derive from balances
      try {
        deposits = await this.q(
          `SELECT wallet_address, balance_usdt AS amount_usdt, updated_at AS created_at, last_deposit_tx AS tx_hash
             FROM credit_balances
            WHERE LOWER(wallet_address) != ALL($1::text[])
              AND balance_usdt > 0`,
          [FOUNDER_WALLETS]
        );
      } catch { deposits = []; }
    }

    if (deposits.length === 0) return { found: false };

    const alreadyFired = await this.q(
      `SELECT 1 FROM automation_logs WHERE job_name = 'customer_zero' AND action = 'alert_fired' LIMIT 1`
    ).then(r => r.length > 0).catch(() => false);

    return { found: true, alreadyFired, deposit: deposits[0] };
  }

  async fireAlert(deposit) {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) { console.warn('[CustomerZero] No DISCORD_WEBHOOK_URL set'); return; }

    const msg = [
      '🎉 **CUSTOMER ZERO — FIRST EXTERNAL DEPOSIT**',
      '',
      `Wallet: \`${deposit.wallet_address}\``,
      `Amount: **${deposit.amount_usdt} USDT**`,
      deposit.tx_hash ? `TX: \`${deposit.tx_hash}\`` : '',
      `Time: ${new Date(deposit.created_at).toISOString()}`,
      '',
      'Verify on-chain before acting on settlement.',
    ].filter(Boolean).join('\n');

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: msg, username: 'Satelink AutoPilot' }),
    });

    await this.q(
      `INSERT INTO automation_logs (job_name, action, result) VALUES ('customer_zero', 'alert_fired', $1)`,
      [JSON.stringify({ wallet: deposit.wallet_address, amount: deposit.amount_usdt })]
    );

    console.log('[CustomerZero] 🎉 Alert fired for', deposit.wallet_address);
  }
}
