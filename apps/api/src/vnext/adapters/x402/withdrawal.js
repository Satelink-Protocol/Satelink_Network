// Withdrawal — component 4. Moves collected USDC from the hot wallet to a FIXED
// operator cold address via a real ERC-20 transfer. Admin-only (mounted behind
// adminAuth), capped, and exactly-once. The token contract (a provider-connected
// ethers.Contract) is the injected boundary (stub in tests, real in prod).
//
// SECURITY (withdrawal-abuse):
//  - destination is FIXED operator config (VNEXT_WITHDRAW_TO), NEVER caller
//    input — cannot be redirected to an attacker.
//  - per-withdrawal cap (VNEXT_WITHDRAW_MAX).
//  - exactly-once: the idem_key row is CLAIMED (reserve) before any transfer;
//    a duplicate/retry returns the existing record and never re-sends.
//  - fail-safe: no signer/token or no dest -> disabled (throws), never a silent
//    no-op that looks successful.

import { ethers } from 'ethers';
import { toMinor, FeeError } from '../../fees/money.js';

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const ERC20_TRANSFER_ABI = ['function transfer(address to, uint256 amount) returns (bool)'];

export class Withdrawal {
  /**
   * @param {object} o
   *  - store (required): DurableStore (withdrawal ledger)
   *  - token (required): provider-connected ERC-20 with transfer(to, amount) -> tx{wait()}
   *  - dest (required): FIXED cold-wallet address
   *  - maxPerWithdrawal: cap (minor units)
   *  - clock
   */
  constructor({ store, token, dest, maxPerWithdrawal, clock } = {}) {
    if (!store) throw new Error('Withdrawal requires a store');
    if (!token || typeof token.transfer !== 'function') throw new Error('Withdrawal requires an ERC-20 token with transfer()');
    if (!dest) throw new Error('Withdrawal requires a fixed destination address');
    this.store = store;
    this.token = token;
    this.dest = dest;
    this.cap = maxPerWithdrawal != null ? toMinor(maxPerWithdrawal, 'maxPerWithdrawal') : null;
    this.clock = clock || (() => Date.now());
  }

  /**
   * @returns {{ ok:boolean, deduped?:boolean, status:string, amount:string, dest:string, ref?:string, reason?:string }}
   */
  async withdraw({ amount, idempotencyKey }) {
    if (!idempotencyKey) throw new FeeError('CONFIG', 'withdraw requires idempotencyKey');
    const amt = toMinor(amount, 'amount');
    if (amt <= 0n) throw new FeeError('CONFIG', 'amount must be > 0');
    if (this.cap != null && amt > this.cap) return { ok: false, status: 'blocked', reason: 'per_withdrawal_cap', amount: amt.toString(), dest: this.dest };

    const key = `withdraw:${idempotencyKey}`;
    // CLAIM before sending -> exactly-once even under retry/concurrency.
    const claim = await this.store.withdrawalAdd({ idem_key: key, amount: amt.toString(), dest: this.dest, ref: null, status: 'pending', ts: this.clock() });
    if (!claim.inserted) {
      const e = claim.entry;
      return { ok: e.status === 'sent', deduped: true, status: e.status, amount: e.amount, dest: e.dest, ref: e.ref || null };
    }

    // Real on-chain transfer to the FIXED destination (never caller-supplied).
    try {
      const tx = await this.token.transfer(this.dest, amt);
      const receipt = tx && typeof tx.wait === 'function' ? await tx.wait() : tx;
      const ref = (receipt && (receipt.hash || receipt.transactionHash)) || (tx && tx.hash) || null;
      // Re-record with the final ref/status (idem row already exists; this is a
      // best-effort status update — a second withdrawalAdd is a no-op, so store
      // the terminal state via a status row keyed distinctly).
      await this.store.withdrawalAdd({ idem_key: `${key}:sent`, amount: amt.toString(), dest: this.dest, ref, status: 'sent', ts: this.clock() });
      return { ok: true, status: 'sent', amount: amt.toString(), dest: this.dest, ref };
    } catch (e) {
      return { ok: false, status: 'error', reason: String((e && e.message) || e), amount: amt.toString(), dest: this.dest };
    }
  }
}

/**
 * Build a real env-driven Withdrawal, or null if unconfigured (endpoint then 403).
 * Requires VNEXT_WITHDRAW_TO (fixed cold address), VNEXT_OUTBOUND_PRIVATE_KEY,
 * and VNEXT_OUTBOUND_RPC_URL. The USDC contract is bound to the wallet as signer.
 */
export function buildWithdrawalFromEnv({ store } = {}) {
  const dest = process.env.VNEXT_WITHDRAW_TO;
  const key = process.env.VNEXT_OUTBOUND_PRIVATE_KEY;
  const url = process.env.VNEXT_OUTBOUND_RPC_URL;
  if (!store || !dest || !key || !url) return null;
  const provider = new ethers.JsonRpcProvider(url);
  const wallet = new ethers.Wallet(key, provider); // key never leaves this scope
  const token = new ethers.Contract(process.env.VNEXT_INBOUND_ASSET || USDC_BASE, ERC20_TRANSFER_ABI, wallet);
  return new Withdrawal({ store, token, dest, maxPerWithdrawal: process.env.VNEXT_WITHDRAW_MAX || null, clock: () => Date.now() });
}
