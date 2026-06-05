'use client';
import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { ClaimButton } from '@/components/payout/ClaimButton';
import { FilterBar } from '@/components/satelink/filter-bar';
import { useDashboardFilters } from '@/lib/stores/dashboard-filters';

const API = 'https://rpc.satelink.network';
const NODE = 'NODE-ap-south-1-a09becbb';

export default function WithdrawClient() {
  const { address, isConnected } = useAccount();
  const [networkRev, setNetworkRev] = useState<any>(null);
  const [claimable, setClaimable]   = useState<number | null>(null);
  const [checking, setChecking]     = useState(false);
  const [lastTx, setLastTx]         = useState<string | null>(null);
  const { fmt } = useDashboardFilters();

  // Fetch network totals (direct backend call)
  useEffect(() => {
    fetch(`${API}/api/epochs`)
      .then(r => r.json())
      .then(d => {
        const ep = d.epochs || [];
        setNetworkRev({
          total:    ep.reduce((s:number,e:any)=>s+parseFloat(e.total_revenue_usdt||0),0),
          node:     ep.reduce((s:number,e:any)=>s+parseFloat(e.node_pool_usdt||0),0),
          platform: ep.reduce((s:number,e:any)=>s+parseFloat(e.platform_share_usdt||0),0),
          distrib:  ep.reduce((s:number,e:any)=>s+parseFloat(e.distributor_share_usdt||0),0),
        });
      }).catch(console.error);
  }, []);

  // When wallet connects, check claimable amount (direct backend calls)
  useEffect(() => {
    if (!address || !isConnected) { setClaimable(null); return; }
    setChecking(true);

    // Two-step: auth then claim
    fetch(`${API}/api/auth/node-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId: NODE, walletAddress: address }),
    })
    .then(r => r.json())
    .then(auth => {
      if (!auth.ok || !auth.token) throw new Error('Auth failed');
      return fetch(`${API}/api/nodes/${NODE}/claim`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${auth.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ walletAddress: address }),
      });
    })
    .then(r => r.json())
    .then(data => {
      console.log('[CLAIM CHECK]', JSON.stringify(data).slice(0, 300));
      if (data?.success || data?.signature) {
        const sig = data.signature || data;
        const amountUsdt = parseFloat(
          sig.amount_usdt ||
          (sig.amount && sig.amount < 1000 ? String(sig.amount) : null) ||
          (sig.amountWei ? String(parseInt(sig.amountWei) / 1_000_000) : null) ||
          '0'
        );
        console.log('[CLAIM CHECK] claimable:', amountUsdt);
        setClaimable(amountUsdt);
      } else {
        setClaimable(0);
      }
    })
    .catch(e => { console.error('[CLAIM CHECK] failed:', e); setClaimable(0); })
    .finally(() => setChecking(false));
  }, [address, isConnected]);

  return (
    <div className="min-h-screen bg-[#091413]">
      <FilterBar page="withdraw" />

      <div className="max-w-xl mx-auto p-6">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-[18px] font-semibold text-[#B0E4CC] tracking-tight">
            Revenue Withdrawal
          </h1>
          <p className="text-[12px] text-[#408A71] mt-1">
            Polygon Mainnet · USDT · Smart contract settlement
          </p>
        </div>

        {/* Network revenue display */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          {!networkRev ? (
            Array.from({length:4}).map((_,i) => (
              <div key={i} className="bg-[#0c1a17] border border-[#1a3028]
                                      rounded h-20 animate-pulse"/>
            ))
          ) : [
            {label:'Network Revenue',  value:fmt(networkRev.total),    glow:false},
            {label:'Node Pool 50%',    value:fmt(networkRev.node),     glow:false},
            {label:'Platform Fee 30%', value:fmt(networkRev.platform), glow:false},
            {label:'Distribution 20%', value:fmt(networkRev.distrib),  glow:false},
          ].map(m => (
            <div key={m.label}
                 className="bg-[#0c1a17] border border-[#1a3028] rounded p-4
                            hover:border-[#285A48] transition-colors">
              <p className="text-[10px] text-[#285A48] uppercase tracking-wider">
                {m.label}
              </p>
              <p className="text-[15px] font-semibold font-mono mt-1.5 text-[#B0E4CC]">
                {m.value}
              </p>
            </div>
          ))}
        </div>

        {/* CLAIM SECTION — always visible */}
        <div className="bg-[#0c1a17] border border-[#1a3028] rounded p-5 mb-4">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-[13px] font-medium text-[#B0E4CC]">
              Node Operator Claim
            </h2>
            {isConnected && claimable !== null && (
              <span className={`text-[9px] px-2 py-0.5 rounded border
                                font-semibold tracking-wider ${
                claimable >= 0.01
                  ? 'bg-[#0f2e1a] text-[#408A71] border-[#285A48]'
                  : 'bg-[#1a1a0f] text-[#a0a030] border-[#3a3e18]'
              }`}>
                {claimable >= 0.01 ? '● CLAIMABLE' : '○ ACCUMULATING'}
              </span>
            )}
          </div>

          {/* STEP 1: Always show wallet connection */}
          {!isConnected ? (
            <div className="space-y-3">
              <p className="text-[12px] text-[#408A71]">
                Connect your Polygon wallet to check earnings and claim USDT
              </p>
              <p className="text-[10px] text-[#285A48]">
                Use wallet: <span className="font-mono text-[#408A71]">
                  0x80AFEaC...dDa3
                </span> (satelink-project test)
              </p>
              {/* ConnectButton ALWAYS renders here */}
              <div className="[&>button]:w-full [&>button]:justify-center
                              [&>button]:bg-[#408A71] [&>button]:text-[#091413]
                              [&>button]:font-semibold [&>button]:text-[13px]
                              [&>button]:rounded [&>button]:py-3
                              [&>button]:hover:bg-[#4fa07f]">
                <ConnectButton />
              </div>
            </div>
          ) : checking ? (
            /* STEP 2: Checking claimable amount */
            <div className="flex items-center gap-3 py-4">
              <div className="w-4 h-4 border-2 border-[#285A48]
                              border-t-[#408A71] rounded-full animate-spin"/>
              <p className="text-[12px] text-[#408A71]">
                Checking claimable earnings...
              </p>
            </div>
          ) : claimable !== null && claimable >= 0.01 ? (
            /* STEP 3A: Has earnings — show claim */
            <div className="space-y-3">
              <div className="bg-[#091413] border border-[#285A48]
                              rounded p-3 text-center">
                <p className="text-[10px] text-[#285A48] uppercase tracking-wider mb-1">
                  Your claimable balance
                </p>
                <p className="text-[24px] font-bold font-mono text-[#00D1FF]">
                  ${claimable.toFixed(6)}
                </p>
                <p className="text-[10px] text-[#285A48] mt-1">USDT · Polygon Mainnet</p>
              </div>
              <ClaimButton
                nodeId={NODE}
                walletAddress={address!}
                onSuccess={tx => setLastTx(tx)}
              />
            </div>
          ) : (
            /* STEP 3B: No earnings yet */
            <div className="text-center py-4">
              <div className="flex items-center gap-2 justify-center mb-2 text-[11px]
                              text-[#285A48]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#408A71]"/>
                {address?.slice(0,6)}...{address?.slice(-4)} connected
              </div>
              <p className="text-[12px] text-[#408A71] font-mono">
                $0.000000 claimable
              </p>
              <p className="text-[11px] text-[#285A48] mt-1">
                Minimum $1.00 USDT required · Revenue accumulating
              </p>
            </div>
          )}
        </div>

        {/* Transaction confirmed */}
        {lastTx && (
          <div className="bg-[#0c2219] border border-[#285A48] rounded p-4 mb-4">
            <p className="text-[10px] text-[#285A48] uppercase tracking-wider mb-1">
              ✓ Transaction confirmed
            </p>
            <a href={`https://polygonscan.com/tx/${lastTx}`}
               target="_blank" rel="noopener"
               className="text-[10px] font-mono text-[#00D1FF]
                          break-all hover:underline">
              {lastTx}
            </a>
          </div>
        )}

        {/* Distribution pool */}
        <div className="bg-[#0c1a17] border border-[#1a3028] rounded p-5 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[13px] font-medium text-[#B0E4CC]">
              Distribution Pool
            </h2>
            <span className="text-[9px] px-2 py-0.5 rounded border
                              bg-[#1a1a0f] text-[#a0a030] border-[#3a3e18]
                              font-semibold tracking-wider">PHASE 2</span>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <p className="text-[10px] text-[#285A48] uppercase tracking-wider">
                Pool Balance
              </p>
              <p className="text-[15px] font-semibold font-mono text-[#B0E4CC] mt-1">
                {networkRev ? fmt(networkRev.distrib) : '—'}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-[#285A48] uppercase tracking-wider">
                Your Share
              </p>
              <p className="text-[15px] font-semibold font-mono text-[#285A48] mt-1">
                $0.000000
              </p>
            </div>
          </div>
          <p className="text-[10px] text-[#285A48] leading-relaxed">
            Distributor payouts launch in Phase 2 when node count reaches 10+.
            Pool accumulates at 20% of all revenue automatically.
          </p>
        </div>

        {/* Revenue split */}
        <div className="bg-[#0c1a17] border border-[#1a3028] rounded p-4">
          <p className="text-[10px] text-[#285A48] uppercase tracking-wider mb-3">
            Revenue split · on-chain enforced
          </p>
          {[
            {role:'Node Operators', pct:50, col:'#408A71'},
            {role:'Platform Fee',   pct:30, col:'#285A48'},
            {role:'Distribution',   pct:20, col:'#00D1FF'},
          ].map(r => (
            <div key={r.role} className="mb-2.5">
              <div className="flex justify-between text-[11px] mb-1">
                <span className="text-[#B0E4CC]">{r.role}</span>
                <span className="font-semibold font-mono"
                      style={{color:r.col}}>{r.pct}%</span>
              </div>
              <div className="h-1 bg-[#091413] rounded-full overflow-hidden">
                <div className="h-full rounded-full"
                     style={{width:`${r.pct}%`,background:r.col}}/>
              </div>
            </div>
          ))}
          <p className="text-[10px] text-[#1a3028] mt-3 font-mono">
            ClaimsContract: 0xE475c53B...fb0 · Polygon 137
          </p>
        </div>

      </div>
    </div>
  );
}
