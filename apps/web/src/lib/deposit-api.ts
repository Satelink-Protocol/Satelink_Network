/**
 * lib/deposit-api.ts
 *
 * Typed client for every data source the Deposit / Revenue Activation page needs.
 *
 * CONTRACT NOTES (read before wiring):
 * - METERING_RATE_USDT is the only economic constant confirmed live in production
 *   ($0.00003/call, verified in SATELINK_ARCHITECTURE_CURRENT.md + session memory).
 *   Do NOT add AI-request or automation-job conversion rates here until those have
 *   a confirmed per-unit price from billing_events. Fabricating a ratio would violate
 *   the "metered ≠ collected" rule — wrong numbers on a payment page are worse than
 *   no numbers.
 * - getNetworkStats() expects whatever endpoint already powers
 *   apps/web/src/app/satelink/os/overview/page.tsx. That page is already live and
 *   already renders these exact fields (metered unbilled, epoch count, requests/24h,
 *   active IPs) — find its fetch call and point NETWORK_STATS_ENDPOINT at the same
 *   URL instead of guessing a new one.
 * - getCreditBalance() / getDepositHistory() / getVaultBalance() hit endpoints that
 *   are NOT confirmed live as of the June 19 session summary. Stub implementations
 *   are provided in api-stub/deposit_economics.js — verify table/column names against
 *   the real schema (`\d credits`, `\d revenue_events`) before deploying them.
 */

export const METERING_RATE_USDT = 0.00003; // confirmed: $0.00003 / RPC call
export const CALLS_PER_USDT = Math.round(1 / METERING_RATE_USDT); // 33,333

const API_BASE =
  process.env.NEXT_PUBLIC_SATELINK_API_BASE ?? 'https://rpc.satelink.network';

// ---- Types -----------------------------------------------------------------

export interface NetworkStats {
  meteredUnbilledUsdt: number;
  epochCount: number;
  requests24h: number;
  activeIps: number;
  lastEpochStatus: 'PENDING' | 'SETTLED' | 'UNKNOWN';
  asOf: string; // ISO timestamp — always show this, never imply "live" without it
}

export interface CreditBalance {
  wallet: string;
  creditsUsdt: number;
  lastDepositAt: string | null;
  pendingDeposits: number;
}

export interface DepositRecord {
  txHash: string;
  amountUsdt: number;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  createdAt: string;
}

export interface VaultProof {
  address: string;
  balanceUsdt: number | null; // null = couldn't read on-chain, show explorer link only
  chain: 'polygon';
  explorerUrl: string;
}

// ---- Fetch helpers -----------------------------------------------------------

async function safeGet<T>(url: string): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      return { data: null, error: `HTTP ${res.status}` };
    }
    const json = await res.json();
    return { data: json as T, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'network error' };
  }
}

// ---- Public API ----------------------------------------------------------

/**
 * Network-wide live stats.
 *
 * There is no single /v1/network/overview endpoint. The /satelink/os/overview page
 * (confirmed live) composes these numbers from three real endpoints, so we read the
 * same ones with the same field mappings — no invented values:
 *   - /api/status              → current_epoch, total_requests_24h
 *   - /api/settlement/history  → metered (sum of epoch totalRevenue), last epoch status
 *   - /system/free-tier        → activeIPs
 */
const STATUS_ENDPOINT = `${API_BASE}/api/status`;
const SETTLEMENT_ENDPOINT = `${API_BASE}/api/settlement/history`;
const FREE_TIER_ENDPOINT = `${API_BASE}/system/free-tier`;

export async function getNetworkStats(): Promise<{ data: NetworkStats | null; error: string | null }> {
  const [status, settlement, freeTier] = await Promise.all([
    safeGet<{ current_epoch: number; total_requests_24h: number }>(STATUS_ENDPOINT),
    safeGet<{ epochs: Array<{ totalRevenue: string; txHash: string | null }> }>(SETTLEMENT_ENDPOINT),
    safeGet<{ activeIPs: number }>(FREE_TIER_ENDPOINT),
  ]);

  // /api/status is the primary signal; if it's down, surface a real error.
  if (!status.data) {
    return { data: null, error: status.error ?? 'network status unavailable' };
  }

  const epochs = settlement.data?.epochs ?? [];
  const meteredUnbilledUsdt = epochs.reduce(
    (sum, e) => sum + (parseFloat(e.totalRevenue) || 0),
    0
  );
  const lastEpochStatus: NetworkStats['lastEpochStatus'] =
    epochs.length === 0 ? 'UNKNOWN' : epochs[0].txHash ? 'SETTLED' : 'PENDING';

  return {
    data: {
      meteredUnbilledUsdt,
      epochCount: status.data.current_epoch ?? 0,
      requests24h: status.data.total_requests_24h ?? 0,
      activeIps: freeTier.data?.activeIPs ?? 0,
      lastEpochStatus,
      asOf: new Date().toISOString(),
    },
    error: null,
  };
}

export async function getCreditBalance(wallet: string) {
  return safeGet<CreditBalance>(`${API_BASE}/v1/credits/balance/${wallet}`);
}

export async function getDepositHistory(wallet: string) {
  return safeGet<DepositRecord[]>(`${API_BASE}/v1/credits/history/${wallet}`);
}

export async function getVaultProof() {
  const address = '0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3';
  const explorerUrl = `https://polygonscan.com/address/${address}`;
  const { data } = await safeGet<{ balanceUsdt: number }>(`${API_BASE}/v1/vault/balance`);
  return {
    address,
    balanceUsdt: data?.balanceUsdt ?? null,
    chain: 'polygon' as const,
    explorerUrl,
  };
}

/** Pure math, no network call — safe to show instantly as the user types an amount. */
export function estimateCapacity(depositUsdt: number) {
  const safe = Number.isFinite(depositUsdt) && depositUsdt > 0 ? depositUsdt : 0;
  return {
    rpcCalls: Math.floor(safe * CALLS_PER_USDT),
  };
}
