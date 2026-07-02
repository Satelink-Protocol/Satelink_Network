// apps/api/src/services/deposit_listener.js
// Polygon on-chain deposit watcher for RevenueVault
// Polls for Deposited(address indexed from, uint256 amount) events and credits
// the CANONICAL account store (api_credits via creditService.creditAccount),
// plus the legacy credit_balances ledger for continuity.
//
// Hardening (machine revenue activation):
//   - Poll-based with a confirmation threshold: an event is only processed once
//     it is >= MIN_CONFIRMATIONS blocks deep (no reorg-refundable credits).
//   - Restart-safe: scan cursor is derived from MAX(block_number) in
//     credit_deposits, so a restart mid-block-range resumes where it left off
//     (bounded by MAX_LOOKBACK_BLOCKS). Processing is idempotent on tx_hash,
//     so overlap re-scans are harmless.
//   - Real transactions: the legacy ledger write uses a single dedicated
//     client (pool.connect) — BEGIN/COMMIT on a pg Pool is NOT transactional.
//   - Unregistered wallets are held in credit_balances only and logged; the
//     machine can register the wallet and claim via POST /api/keys/deposit.
//
// Chain: Polygon Mainnet (137)

import { ethers } from 'ethers';
import { resolveAccount, creditAccount, TIER_DAILY_LIMIT } from '../billing/credit_service.mjs';
import { MIN_CONFIRMATIONS } from '../billing/deposit_validation.mjs';

const REVENUE_VAULT_ABI = [
  'event Deposited(address indexed from, uint256 amount)'
];

// USDT uses 6 decimals on Polygon
const USDT_DECIMALS = 6;
const LOG_PREFIX = '[DepositListener]';

const DEFAULTS = {
  pollIntervalMs: 60_000,
  confirmations: MIN_CONFIRMATIONS,     // single source of truth with the claim route
  chunkBlocks: 5_000,                   // max block span per eth_getLogs call
  maxLookbackBlocks: 50_000,            // ~1 day on Polygon; caps a cold-start scan
  initialLookbackBlocks: 10_000,        // first-run window when no cursor exists
};

export class DepositListener {
  constructor(db, logger, opts = {}) {
    this.db = db;
    this.log = logger || console;
    this.opts = { ...DEFAULTS, ...opts };
    this.provider = opts.provider || null; // injectable for tests
    this.contract = null;
    this.running = false;
    this.chainId = opts.chainId || 137;
    this._timer = null;
    this._polling = false;
    this._lastScanned = 0; // in-memory high-water mark (DB cursor only moves on deposits)
  }

  async start() {
    const rpcUrl = process.env.POLYGON_RPC_URL || process.env.RPC_URL;
    const vaultAddress = process.env.REVENUE_VAULT_ADDRESS;

    if (!vaultAddress) {
      this.log.warn(`${LOG_PREFIX} REVENUE_VAULT_ADDRESS not set — listener disabled`);
      return;
    }
    if (!this.provider && !rpcUrl) {
      this.log.warn(`${LOG_PREFIX} POLYGON_RPC_URL not set — listener disabled`);
      return;
    }

    this.vaultAddress = vaultAddress;
    if (!this.provider) {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
    }

    try {
      const network = await this.provider.getNetwork();
      this.chainId = Number(network.chainId);
    } catch (err) {
      // Non-fatal: keep the default chainId and let the first poll retry.
      this.log.warn(`${LOG_PREFIX} getNetwork failed (${err.message}) — assuming chain=${this.chainId}`);
    }

    this.contract = new ethers.Contract(this.vaultAddress, REVENUE_VAULT_ABI, this.provider);
    this.running = true;
    this.log.info(
      `${LOG_PREFIX} started chain=${this.chainId} vault=${this.vaultAddress} ` +
      `confirmations=${this.opts.confirmations} poll=${this.opts.pollIntervalMs}ms`
    );

    // Immediate first scan, then steady polling.
    await this._pollSafe();
    this._timer = setInterval(() => this._pollSafe(), this.opts.pollIntervalMs);
  }

  async stop() {
    this.running = false;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    this.contract = null;
    if (this.provider?.destroy) { try { this.provider.destroy(); } catch {} }
    this.provider = null;
    this.log.info(`${LOG_PREFIX} stopped`);
  }

  async _pollSafe() {
    if (this._polling || !this.running) return;
    this._polling = true;
    try {
      await this._pollOnce();
    } catch (err) {
      this.log.error(`${LOG_PREFIX} poll failed: ${err.message} — retrying next interval`);
    } finally {
      this._polling = false;
    }
  }

  /** Where to resume: last credited block from the DB (restart-safe cursor). */
  async _dbCursor() {
    const r = await this.db.query(
      `SELECT COALESCE(MAX(block_number), 0) AS cursor
         FROM credit_deposits
        WHERE chain_id = $1 AND block_number > 0`,
      [this.chainId]
    );
    return parseInt(r.rows?.[0]?.cursor, 10) || 0;
  }

  async _pollOnce() {
    const current = await this.provider.getBlockNumber();
    const toBlock = current - this.opts.confirmations;
    if (toBlock <= 0) return;

    const cursor = Math.max(await this._dbCursor(), this._lastScanned);
    let fromBlock = cursor > 0 ? cursor + 1 : toBlock - this.opts.initialLookbackBlocks;
    // Bound a cold or long-idle start so we never scan an unbounded range.
    fromBlock = Math.max(fromBlock, toBlock - this.opts.maxLookbackBlocks, 0);
    if (fromBlock > toBlock) return; // fully caught up

    let credited = 0;
    for (let start = fromBlock; start <= toBlock; start += this.opts.chunkBlocks) {
      const end = Math.min(start + this.opts.chunkBlocks - 1, toBlock);
      const events = await this.contract.queryFilter('Deposited', start, end);
      for (const ev of events) {
        const [from, amount] = ev.args;
        const ok = await this._handleDeposit(
          from, amount, ev.transactionHash, ev.blockNumber, this.chainId
        );
        if (ok) credited += 1;
      }
      this._lastScanned = end;
    }

    if (credited > 0) {
      this.log.info(`${LOG_PREFIX} scan ${fromBlock}..${toBlock}: credited ${credited} deposit(s)`);
    }
  }

  /**
   * Process one confirmed Deposited event. Idempotent on tx_hash across BOTH
   * ledgers (credit_deposits UNIQUE + api_deposits UNIQUE), so re-scans and
   * races with the manual claim route can never double-credit.
   * Returns true when a new deposit was recorded.
   */
  async _handleDeposit(from, amount, txHash, blockNumber, chainId) {
    const wallet = String(from).toLowerCase();
    const amountUsdt = parseFloat(ethers.formatUnits(amount, USDT_DECIMALS));

    try {
      // ── Idempotency: skip if already processed
      const exists = await this.db.query(
        'SELECT id FROM credit_deposits WHERE tx_hash = $1',
        [txHash]
      );
      if (exists.rows.length > 0) return false;

      this.log.info(`${LOG_PREFIX} Deposit confirmed: wallet=${wallet} amount=${amountUsdt} USDT tx=${txHash} block=${blockNumber}`);

      // ── Legacy ledger (credit_balances) — one dedicated client so the
      // transaction is real. A concurrent insert of the same tx_hash loses on
      // the UNIQUE constraint and rolls back (no double-credit).
      const client = this.db.connect ? await this.db.connect() : this.db;
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO credit_deposits
             (wallet_address, amount_usdt, tx_hash, block_number, chain_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [wallet, amountUsdt, txHash, blockNumber, chainId]
        );
        await client.query(
          `INSERT INTO credit_balances
             (wallet_address, balance_usdt, total_deposited, last_deposit_tx, last_deposit_at, updated_at)
           VALUES ($1, $2, $2, $3, NOW(), NOW())
           ON CONFLICT (wallet_address) DO UPDATE SET
             balance_usdt    = credit_balances.balance_usdt + $2,
             total_deposited = credit_balances.total_deposited + $2,
             last_deposit_tx = $3,
             last_deposit_at = NOW(),
             updated_at      = NOW()`,
          [wallet, amountUsdt, txHash]
        );
        await client.query('COMMIT');
      } catch (innerErr) {
        await client.query('ROLLBACK').catch(() => {});
        throw innerErr;
      } finally {
        if (client !== this.db && client.release) client.release();
      }

      // ── CANONICAL crediting (api_credits) — the balance the serving path
      // actually deducts from (CREDIT_CANONICAL=true). Idempotent on tx_hash
      // via api_deposits UNIQUE, shared with POST /api/keys/deposit.
      await this._creditCanonical(wallet, amountUsdt, txHash);

      return true;
    } catch (err) {
      this.log.error(
        `${LOG_PREFIX} Failed to credit deposit: ${err.message}`,
        { txHash, wallet, amountUsdt }
      );
      return false;
    }
  }

  async _creditCanonical(wallet, amountUsdt, txHash) {
    const minDeposit = parseFloat(process.env.MIN_DEPOSIT_USDT || '0.50');
    try {
      const account = await resolveAccount(this.db, { wallet });
      if (!account) {
        this.log.warn(
          `${LOG_PREFIX} Deposit from UNREGISTERED wallet ${wallet} (${amountUsdt} USDT, tx=${txHash}) — ` +
          `held in credit_balances. Register via POST /v1/machine/register, then claim via POST /api/keys/deposit.`
        );
        return;
      }

      // Free-tier calls bill $0, so credits on a free account would never be
      // consumed. A funded deposit >= minimum lifts the account to basic
      // (pay-per-call at $0.00003) so the credits are actually spendable.
      const upgrade =
        account.tier === 'free' && amountUsdt >= minDeposit
          ? { tier: 'basic', dailyLimit: TIER_DAILY_LIMIT.basic }
          : {};

      const result = await creditAccount(this.db, {
        wallet,
        amountUsdt,
        txHash,
        fromAddress: wallet,
        ...upgrade,
      });

      if (result.ok) {
        this.log.info(
          `${LOG_PREFIX} Credited ${amountUsdt} USDT to api_credits account ` +
          `${result.apiKey.slice(0, 12)}… (tier=${result.tier}, balance=${result.balance})`
        );
      } else if (result.code === 'tx_already_used') {
        this.log.info(`${LOG_PREFIX} tx=${txHash} already credited canonically — skipping`);
      } else {
        this.log.error(`${LOG_PREFIX} canonical credit failed: ${result.code} tx=${txHash}`);
      }
    } catch (err) {
      // A unique-violation here means the claim route won the race — fine.
      if (String(err.code) === '23505' || /duplicate key/i.test(err.message)) {
        this.log.info(`${LOG_PREFIX} tx=${txHash} credited concurrently by claim route — skipping`);
        return;
      }
      this.log.error(`${LOG_PREFIX} canonical credit error: ${err.message} tx=${txHash}`);
    }
  }

  // Manual credit for testing (does not require on-chain event)
  async creditManual({ walletAddress, amountUsdt, txHash, blockNumber, chainId = 137 }) {
    const wallet = String(walletAddress).toLowerCase();
    if (!wallet.match(/^0x[0-9a-f]{40}$/)) throw new Error('Invalid wallet address');
    if (amountUsdt <= 0) throw new Error('Amount must be positive');

    await this._handleDeposit(
      wallet,
      ethers.parseUnits(String(amountUsdt), USDT_DECIMALS),
      txHash || `0xmanual_${Date.now()}`,
      blockNumber || 0,
      chainId
    );
    return { ok: true, wallet, amountUsdt };
  }
}
