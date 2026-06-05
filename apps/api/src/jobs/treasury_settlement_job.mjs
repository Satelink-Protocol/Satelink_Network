/**
 * TreasurySettlementJob — Auto-forward deposits to ClaimsContract
 *
 * Flow:
 * 1. Check treasury USDT balance on Polygon
 * 2. Compare to last known balance (stored in DB)
 * 3. If increased, new deposit detected
 * 4. Split: 50% → ClaimsContract (node operators)
 *          30% → Platform fee (stays in treasury)
 *          20% → Distribution pool (tracked, held in treasury)
 * 5. Transfer 50% to ClaimsContract on-chain
 * 6. Log the settlement for audit
 *
 * This makes node operators' claims funded automatically
 * after any API key deposit, no manual forwarding needed.
 */

import { ethers } from 'ethers';

const USDT_POLYGON = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
const CLAIMS_CONTRACT = process.env.CLAIMS_CONTRACT_ADDRESS || '0x6987921e2453f360e314e4424F6c2789F10a1CC9';
const TREASURY = process.env.TREASURY_ADDRESS || '0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3';
const POLYGON_RPC = process.env.POLYGON_RPC_URL || 'https://polygon.drpc.org';

const SPLIT_NODE_OPERATORS = 0.50;
const SPLIT_PLATFORM = 0.30;
const SPLIT_DISTRIBUTION = 0.20;

const MIN_SETTLEMENT_USDT = 1.0;

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

export class TreasurySettlementJob {
  constructor(pool) {
    this.pool = pool;
    this.provider = null;
    this.wallet = null;
    this.usdt = null;
    this.configured = false;
    this.running = false;

    this._init();
  }

  _init() {
    try {
      this.provider = new ethers.JsonRpcProvider(POLYGON_RPC);

      const signerKey = process.env.TREASURY_SIGNER_KEY || process.env.POLYGON_SIGNER_KEY;
      if (signerKey) {
        this.wallet = new ethers.Wallet(signerKey, this.provider);
        this.usdt = new ethers.Contract(USDT_POLYGON, ERC20_ABI, this.wallet);
        this.configured = true;
        console.log(`[TreasurySettlement] Configured — signer: ${this.wallet.address.slice(0, 10)}...`);
      } else {
        this.usdt = new ethers.Contract(USDT_POLYGON, ERC20_ABI, this.provider);
        console.log('[TreasurySettlement] Read-only mode — no signer key configured');
      }
    } catch (e) {
      console.error('[TreasurySettlement] Init failed:', e.message);
    }
  }

  async ensureTables() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS treasury_state (
        id SERIAL PRIMARY KEY,
        last_balance_usdt NUMERIC(18,6) DEFAULT 0,
        last_checked_at TIMESTAMP DEFAULT NOW(),
        total_settled_usdt NUMERIC(18,6) DEFAULT 0,
        total_to_claims_usdt NUMERIC(18,6) DEFAULT 0,
        total_platform_usdt NUMERIC(18,6) DEFAULT 0,
        total_distribution_usdt NUMERIC(18,6) DEFAULT 0
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS treasury_settlements (
        id SERIAL PRIMARY KEY,
        deposit_amount_usdt NUMERIC(18,6) NOT NULL,
        node_share_usdt NUMERIC(18,6) NOT NULL,
        platform_share_usdt NUMERIC(18,6) NOT NULL,
        distribution_share_usdt NUMERIC(18,6) NOT NULL,
        tx_hash VARCHAR(66),
        status VARCHAR(20) DEFAULT 'pending',
        error_message TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        confirmed_at TIMESTAMP
      )
    `);

    const stateExists = await this.pool.query('SELECT id FROM treasury_state LIMIT 1');
    if (stateExists.rows.length === 0) {
      await this.pool.query('INSERT INTO treasury_state (last_balance_usdt) VALUES (0)');
    }
  }

  async getCurrentBalance() {
    try {
      const balance = await this.usdt.balanceOf(TREASURY);
      return parseFloat(ethers.formatUnits(balance, 6));
    } catch (e) {
      console.error('[TreasurySettlement] Balance check failed:', e.message);
      return null;
    }
  }

  async getLastKnownBalance() {
    const result = await this.pool.query(
      'SELECT last_balance_usdt FROM treasury_state ORDER BY id DESC LIMIT 1'
    );
    return parseFloat(result.rows[0]?.last_balance_usdt || 0);
  }

  async run() {
    if (this.running) {
      console.log('[TreasurySettlement] Already running, skipping');
      return { skipped: true };
    }

    this.running = true;
    console.log('[TreasurySettlement] Running check...');

    try {
      await this.ensureTables();

      const currentBalance = await this.getCurrentBalance();
      if (currentBalance === null) {
        this.running = false;
        return { error: 'Failed to get balance' };
      }

      const lastBalance = await this.getLastKnownBalance();
      const increase = currentBalance - lastBalance;

      console.log(`[TreasurySettlement] Balance: $${currentBalance.toFixed(6)} (prev: $${lastBalance.toFixed(6)}, diff: $${increase.toFixed(6)})`);

      // Update last checked time regardless
      await this.pool.query(
        'UPDATE treasury_state SET last_checked_at = NOW() WHERE id = (SELECT id FROM treasury_state ORDER BY id DESC LIMIT 1)'
      );

      if (increase < MIN_SETTLEMENT_USDT) {
        console.log(`[TreasurySettlement] No significant increase (min: $${MIN_SETTLEMENT_USDT})`);
        this.running = false;
        return {
          settled: false,
          current_balance: currentBalance,
          increase,
          reason: 'Below minimum threshold'
        };
      }

      // Calculate splits
      const nodeShare = increase * SPLIT_NODE_OPERATORS;
      const platformShare = increase * SPLIT_PLATFORM;
      const distributionShare = increase * SPLIT_DISTRIBUTION;

      console.log(`[TreasurySettlement] Detected deposit: $${increase.toFixed(6)}`);
      console.log(`  → Node operators (50%): $${nodeShare.toFixed(6)}`);
      console.log(`  → Platform fee (30%): $${platformShare.toFixed(6)}`);
      console.log(`  → Distribution pool (20%): $${distributionShare.toFixed(6)}`);

      // Record pending settlement
      const settlementResult = await this.pool.query(`
        INSERT INTO treasury_settlements
        (deposit_amount_usdt, node_share_usdt, platform_share_usdt, distribution_share_usdt, status)
        VALUES ($1, $2, $3, $4, 'pending')
        RETURNING id
      `, [increase, nodeShare, platformShare, distributionShare]);

      const settlementId = settlementResult.rows[0].id;

      // Transfer 50% to ClaimsContract
      let txHash = null;
      let status = 'pending';
      let errorMessage = null;

      if (this.configured && process.env.SETTLEMENT_DRY_RUN !== '1') {
        try {
          const amountWei = ethers.parseUnits(nodeShare.toFixed(6), 6);

          console.log(`[TreasurySettlement] Sending $${nodeShare.toFixed(6)} USDT to ClaimsContract...`);
          const tx = await this.usdt.transfer(CLAIMS_CONTRACT, amountWei);
          console.log(`[TreasurySettlement] TX submitted: ${tx.hash}`);

          const receipt = await tx.wait(1);
          if (receipt && receipt.status === 1) {
            txHash = tx.hash;
            status = 'confirmed';
            console.log(`[TreasurySettlement] TX confirmed in block ${receipt.blockNumber}`);
          } else {
            throw new Error('Transaction reverted');
          }
        } catch (e) {
          errorMessage = e.message;
          status = 'failed';
          console.error('[TreasurySettlement] Transfer failed:', e.message);
        }
      } else {
        // Dry run / simulation
        txHash = `0xSIM_${Date.now().toString(16)}`;
        status = 'simulated';
        console.log(`[TreasurySettlement] SIMULATION — would send $${nodeShare.toFixed(6)} to ${CLAIMS_CONTRACT}`);
      }

      // Update settlement record
      await this.pool.query(`
        UPDATE treasury_settlements
        SET tx_hash = $1, status = $2, error_message = $3, confirmed_at = CASE WHEN $2 = 'confirmed' THEN NOW() ELSE NULL END
        WHERE id = $4
      `, [txHash, status, errorMessage, settlementId]);

      // Update treasury state with new balance
      if (status === 'confirmed' || status === 'simulated') {
        await this.pool.query(`
          UPDATE treasury_state SET
            last_balance_usdt = $1,
            total_settled_usdt = total_settled_usdt + $2,
            total_to_claims_usdt = total_to_claims_usdt + $3,
            total_platform_usdt = total_platform_usdt + $4,
            total_distribution_usdt = total_distribution_usdt + $5
          WHERE id = (SELECT id FROM treasury_state ORDER BY id DESC LIMIT 1)
        `, [currentBalance, increase, nodeShare, platformShare, distributionShare]);

        // Credit node earnings so they can claim
        await this.creditNodeEarnings(nodeShare);
      }

      this.running = false;
      return {
        settled: true,
        deposit_amount: increase,
        node_share: nodeShare,
        platform_share: platformShare,
        distribution_share: distributionShare,
        tx_hash: txHash,
        status
      };

    } catch (e) {
      console.error('[TreasurySettlement] Error:', e.message);
      this.running = false;
      return { error: e.message };
    }
  }

  async creditNodeEarnings(totalNodeShare) {
    try {
      // Get active nodes — nodes table uses `wallet` not `wallet_address`
      const nodesResult = await this.pool.query(`
        SELECT node_id, wallet
        FROM nodes WHERE status = 'active'
      `);

      const nodes = nodesResult.rows;
      if (nodes.length === 0) {
        console.log('[TreasurySettlement] No active nodes to credit');
        return;
      }

      // Equal split for now (can add weight-based later)
      const perNodeShare = totalNodeShare / nodes.length;

      for (const node of nodes) {
        await this.pool.query(`
          INSERT INTO claims (node_id, wallet, amount_usdt, status, created_at)
          VALUES ($1, $2, $3, 'pending', NOW())
        `, [node.node_id, node.wallet, perNodeShare]);

        console.log(`[TreasurySettlement] Credited ${node.node_id}: $${perNodeShare.toFixed(6)}`);
      }

      console.log(`[TreasurySettlement] Credited ${nodes.length} nodes with $${perNodeShare.toFixed(6)} each`);
    } catch (e) {
      console.error('[TreasurySettlement] Failed to credit nodes:', e.message);
    }
  }

  async getStatus() {
    const [state, recentSettlements, currentBalance] = await Promise.all([
      this.pool.query('SELECT * FROM treasury_state ORDER BY id DESC LIMIT 1'),
      this.pool.query('SELECT * FROM treasury_settlements ORDER BY created_at DESC LIMIT 5'),
      this.getCurrentBalance()
    ]);

    return {
      treasury_address: TREASURY,
      claims_contract: CLAIMS_CONTRACT,
      current_balance_usdt: currentBalance,
      state: state.rows[0] || {},
      recent_settlements: recentSettlements.rows,
      splits: {
        node_operators: `${SPLIT_NODE_OPERATORS * 100}%`,
        platform: `${SPLIT_PLATFORM * 100}%`,
        distribution: `${SPLIT_DISTRIBUTION * 100}%`
      },
      configured: this.configured,
      dry_run: process.env.SETTLEMENT_DRY_RUN === '1'
    };
  }
}

export function createTreasurySettlementJob(pool) {
  return new TreasurySettlementJob(pool);
}

export function startTreasurySettlementScheduler(pool, intervalMinutes = 5) {
  const job = new TreasurySettlementJob(pool);

  const runJob = async () => {
    try {
      const result = await job.run();
      if (result.settled) {
        console.log(`[TreasurySettlement] Settlement complete: $${result.deposit_amount.toFixed(6)} → ${result.status}`);
      }
    } catch (e) {
      console.error('[TreasurySettlement] Scheduled run failed:', e.message);
    }
  };

  // Run immediately on startup
  runJob();

  // Then run every N minutes
  const intervalMs = intervalMinutes * 60 * 1000;
  const interval = setInterval(runJob, intervalMs);

  console.log(`[TreasurySettlement] Scheduler started — checking every ${intervalMinutes} minutes`);

  return {
    job,
    runNow: runJob,
    stop: () => clearInterval(interval)
  };
}
