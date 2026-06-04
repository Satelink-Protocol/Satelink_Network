'use client';

import { useEffect, useState } from 'react';

const REVENUE_VAULT = '0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3';
const TREASURY_ADDRESS = '0x966E1Ae22996545015b1414B35234b10719d7Ad4';
const USDT_CONTRACT = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
const RPC_URL = 'https://rpc.satelink.network/rpc/polygon';

async function fetchUsdtBalance(address: string): Promise<string> {
  const data = '0x70a08231000000000000000000000000' + address.slice(2).toLowerCase();
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_call',
      params: [{ to: USDT_CONTRACT, data }, 'latest'],
      id: 1,
    }),
  });
  const d = await res.json();
  if (!d.result || d.result === '0x') return '0.00';
  return (Number(BigInt(d.result)) / 1e6).toFixed(2);
}

async function fetchPolBalance(address: string): Promise<string> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_getBalance',
      params: [address, 'latest'],
      id: 2,
    }),
  });
  const d = await res.json();
  if (!d.result) return '0.0000';
  return (Number(BigInt(d.result)) / 1e18).toFixed(4);
}

export default function TreasuryPage() {
  const [vaultUsdt, setVaultUsdt] = useState<string | null>(null);
  const [treasuryUsdt, setTreasuryUsdt] = useState<string | null>(null);
  const [treasuryPol, setTreasuryPol] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [vu, tu, tp] = await Promise.all([
          fetchUsdtBalance(REVENUE_VAULT),
          fetchUsdtBalance(TREASURY_ADDRESS),
          fetchPolBalance(TREASURY_ADDRESS),
        ]);
        setVaultUsdt(vu);
        setTreasuryUsdt(tu);
        setTreasuryPol(tp);
      } catch (err) {
        console.error('Failed to fetch treasury balances:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-[15px] font-semibold text-[#B0E4CC]">Treasury</h1>
        <p className="text-[11px] text-[#285A48] mt-0.5">
          On-chain balances · Polygon Mainnet · live via RPC
        </p>
      </div>

      {/* Customer Deposit Vault — PRIMARY */}
      <div className="bg-[#0c1a17] border border-[#285A48] rounded-md p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-2 h-2 rounded-full bg-[#408A71] animate-pulse" />
          <p className="text-[10px] text-[#285A48] uppercase tracking-wider font-semibold">
            Customer Deposit Vault (RevenueVault)
          </p>
        </div>
        <div className="flex items-center gap-3 mb-4">
          <code className="text-[12px] font-mono text-[#00D1FF] break-all flex-1">
            {REVENUE_VAULT}
          </code>
          <a
            href={`https://polygonscan.com/address/${REVENUE_VAULT}`}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-[10px] px-2.5 py-1 rounded border border-[#285A48] text-[#408A71] hover:text-[#B0E4CC] hover:border-[#408A71] transition-colors"
          >
            Polygonscan ↗
          </a>
        </div>
        <div className="flex items-baseline gap-3">
          {loading ? (
            <div className="h-8 w-36 bg-[#091413] rounded animate-pulse" />
          ) : (
            <>
              <p className="text-[28px] font-bold font-mono text-[#00D1FF]">
                ${vaultUsdt ?? '—'}
              </p>
              <span className="text-[13px] text-[#408A71]">USDT</span>
            </>
          )}
        </div>
        <p className="text-[10px] text-[#285A48] mt-1">
          All customer deposits go here. This is the canonical revenue source.
        </p>
      </div>

      {/* Platform Treasury */}
      <div className="bg-[#0c1a17] border border-[#1a3028] rounded-md p-5">
        <p className="text-[10px] text-[#285A48] uppercase tracking-wider mb-3">
          Platform Treasury
        </p>
        <div className="flex items-center gap-3 mb-4">
          <code className="text-[12px] font-mono text-[#B0E4CC] break-all flex-1">
            {TREASURY_ADDRESS}
          </code>
          <a
            href={`https://polygonscan.com/address/${TREASURY_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-[10px] px-2.5 py-1 rounded border border-[#285A48] text-[#408A71] hover:text-[#B0E4CC] hover:border-[#408A71] transition-colors"
          >
            Polygonscan ↗
          </a>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] text-[#285A48] uppercase tracking-wider mb-1">USDT</p>
            {loading ? (
              <div className="h-7 w-24 bg-[#091413] rounded animate-pulse" />
            ) : (
              <p className="text-[20px] font-bold font-mono text-[#B0E4CC]">
                ${treasuryUsdt ?? '—'}
              </p>
            )}
          </div>
          <div>
            <p className="text-[10px] text-[#285A48] uppercase tracking-wider mb-1">POL</p>
            {loading ? (
              <div className="h-7 w-24 bg-[#091413] rounded animate-pulse" />
            ) : (
              <p className="text-[20px] font-bold font-mono text-[#B0E4CC]">
                {treasuryPol ?? '—'}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Revenue Split */}
      <div className="bg-[#0c1a17] border border-[#1a3028] rounded-md p-5">
        <p className="text-[10px] text-[#285A48] uppercase tracking-wider mb-3">Revenue Split</p>
        <div className="space-y-2">
          {[
            { label: 'Node Operators', pct: 50, color: '#408A71' },
            { label: 'Platform Fee', pct: 30, color: '#285A48' },
            { label: 'Distribution Pool', pct: 20, color: '#00D1FF' },
          ].map((r) => (
            <div key={r.label} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: r.color }} />
                <span className="text-[11px] text-[#B0E4CC]">{r.label}</span>
              </div>
              <span className="text-[12px] font-mono font-semibold" style={{ color: r.color }}>
                {r.pct}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
