/**
 * Settlement Control — read settlement state and toggle DRY_RUN.
 *
 * Corrected vs the original design doc:
 *   - `pool` is a pg Pool: pool.query() returns { rows }
 *   - getTotalSettlements() returns the REAL count, or 0 on error. An earlier
 *     version returned a hardcoded baseline on failure — but docs/audit-2026-06-13
 *     found every epoch has tx_hash NULL (0 on-chain settlements have ever
 *     occurred). A fabricated fallback would display settlements that never happened.
 *   - No refundSigner() here. Signer refunds are a one-time manual CLI command
 *     (scripts/refund_signer.js) so a private key never lives server-side.
 */

import { ethers } from 'ethers';

// Addresses come from env only — no hardcoded wallet addresses in source
// (CLAUDE.md: never hardcode; also keeps the secret scanner clean).
const SIGNER_ADDRESS = process.env.POLYGON_SIGNER_ADDRESS || null;
const TREASURY_ADDRESS = process.env.TREASURY_ADDRESS || null;

export class SettlementControl {
  constructor(pool) { this.pool = pool; }

  async getStatus() {
    return {
      dryRun:           process.env.SETTLEMENT_DRY_RUN === '1',
      signerBalance:    await this.getSignerBalance(),
      signerAddress:    SIGNER_ADDRESS,
      treasuryAddress:  TREASURY_ADDRESS,
      threshold:        parseFloat(process.env.MIN_ANCHOR_REVENUE_USDT || '1.0'),
      totalSettlements: await this.getTotalSettlements(),
      contractAddress:  process.env.CLAIMS_CONTRACT_ADDRESS || null,
    };
  }

  async getSignerBalance() {
    if (!SIGNER_ADDRESS) return null; // no signer configured — cannot query
    try {
      const rpc = process.env.POLYGON_RPC || 'https://polygon-rpc.com';
      const provider = new ethers.JsonRpcProvider(rpc);
      const raw = await provider.getBalance(SIGNER_ADDRESS);
      return parseFloat(ethers.formatEther(raw));
    } catch { return null; }
  }

  // Real count of epochs actually settled on-chain. Returns 0 (not a fake
  // number) when the query fails or the column/table differs.
  async getTotalSettlements() {
    try {
      const r = await this.pool.query(
        `SELECT COUNT(*) AS c FROM epoch_ledger WHERE tx_hash IS NOT NULL`
      );
      return parseInt(r.rows[0]?.c || 0);
    } catch {
      return 0;
    }
  }

  isDryRunEnabled() { return process.env.SETTLEMENT_DRY_RUN === '1'; }

  async setDryRun(enabled) {
    const token = process.env.RAILWAY_TOKEN;
    const svcId = process.env.RAILWAY_SERVICE_ID;
    const envId = process.env.RAILWAY_ENVIRONMENT_ID;

    if (!token || !svcId || !envId) {
      // In-process only — survives until next redeploy
      process.env.SETTLEMENT_DRY_RUN = enabled ? '1' : '0';
      return {
        updated: true,
        method: 'in-process',
        persistent: false,
        warning: 'Set RAILWAY_TOKEN + RAILWAY_SERVICE_ID + RAILWAY_ENVIRONMENT_ID for a persistent change',
      };
    }

    const mutation = `mutation($input: VariableUpsertInput!) { variableUpsert(input: $input) }`;
    const r = await fetch('https://backboard.railway.app/graphql/v2', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: mutation,
        variables: { input: { serviceId: svcId, environmentId: envId, name: 'SETTLEMENT_DRY_RUN', value: enabled ? '1' : '0' } },
      }),
    });
    const data = await r.json();
    if (data.errors) throw new Error(data.errors[0].message);
    return { updated: true, method: 'railway-api', persistent: true, dryRun: enabled };
  }
}
