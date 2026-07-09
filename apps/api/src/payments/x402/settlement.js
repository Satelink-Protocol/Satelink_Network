// apps/api/src/payments/x402/settlement.js
// Records a facilitator-settled x402 payment in one transaction:
//   payment_sources (ledger of external payments, tx_hash UNIQUE)
//   revenue_events_v2 (demand_source='x402', same shape as rpc_billing.js)
//
// Replay protection is the facilitator's verify/settle PLUS the tx_hash
// UNIQUE constraint here — a duplicate settlement id throws
// DuplicateSettlementError and the caller returns 409 without serving.
// No signature/crypto verification happens in this file by design.

export class DuplicateSettlementError extends Error {
  constructor(txHash) {
    super(`x402 settlement already recorded: ${txHash}`);
    this.name = 'DuplicateSettlementError';
    this.txHash = txHash;
  }
}

// A settlement on a test network must never masquerade as real revenue
// (INC-013 class of problem). eip155:84532 = base-sepolia.
export function isTestNetwork(network) {
  return /84532|sepolia|testnet/i.test(String(network));
}

export async function recordX402Settlement(pool, { txHash, payer, network, amountUsd, apiKey = null }) {
  const isTest = isTestNetwork(network);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO payment_sources (source, amount_usd, token, network, tx_hash, payer, credited_api_key, is_test_data)
       VALUES ('x402', $1, 'USDC', $2, $3, $4, $5, $6)`,
      [amountUsd, network, txHash, payer, apiKey, isTest]
    );
    // created_at is epoch seconds and status 'completed', mirroring
    // rpc_billing.js so downstream revenue queries see a consistent shape.
    // request_id 'x402:<tx>' rides the existing unique index as a second
    // duplicate guard.
    await client.query(
      `INSERT INTO revenue_events_v2 (op_type, client_id, amount_usdt, status, request_id, created_at, chain, method, source, demand_source, is_test_data)
       VALUES ('rpc_call', $1, $2, 'completed', $3, $4, $5, null, 'x402', 'x402', $6)`,
      [payer, amountUsd, `x402:${txHash}`, Math.floor(Date.now() / 1000), network, isTest]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') throw new DuplicateSettlementError(txHash);
    throw err;
  } finally {
    client.release();
  }
}
