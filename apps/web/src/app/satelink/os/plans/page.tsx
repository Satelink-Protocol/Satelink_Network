'use client';

import { useState } from 'react';

const API = 'https://rpc.satelink.network';
const TREASURY = '0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3';

const PLANS = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    limit: '200 req/day',
    features: ['No API key required', 'Public RPC access', 'All 6 chains', 'Community support'],
    tier: 'free',
    priceUsdt: 0,
    cta: 'Get Free Key',
    highlight: false,
  },
  {
    name: 'Basic',
    price: '$9',
    period: '/month',
    limit: '10,000 req/day',
    features: ['API key required', 'Priority routing', 'All chains', 'Email support', 'Usage analytics'],
    tier: 'basic',
    priceUsdt: 9,
    cta: 'Activate Basic',
    highlight: false,
  },
  {
    name: 'Pro',
    price: '$49',
    period: '/month',
    limit: '100,000 req/day',
    features: ['API key required', 'MEV relay access', 'WebSocket support', 'All chains', 'Priority support'],
    tier: 'pro',
    priceUsdt: 49,
    cta: 'Activate Pro',
    highlight: true,
  },
  {
    name: 'Enterprise',
    price: '$199',
    period: '/month',
    limit: '1M+ req/day',
    features: ['Dedicated nodes', 'SLA guarantee', 'Custom chains', '24/7 support', 'Volume discounts'],
    tier: 'enterprise',
    priceUsdt: 199,
    cta: 'Activate Enterprise',
    highlight: false,
  },
];

interface ApiKeyResult {
  ok: boolean;
  api_key?: string;
  tier?: string;
  daily_limit?: number;
  usage?: string;
  example?: string;
  error?: string;
}

interface DepositResult {
  ok: boolean;
  deposited_usdt?: number;
  new_tier?: string;
  new_daily_limit?: number;
  message?: string;
  error?: string;
}

export default function PlansPage() {
  const [result, setResult] = useState<ApiKeyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showDeposit, setShowDeposit] = useState<string | null>(null);
  const [txHash, setTxHash] = useState('');
  const [depositLoading, setDepositLoading] = useState(false);
  const [depositResult, setDepositResult] = useState<DepositResult | null>(null);

  async function getFreeKey() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`${API}/api/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: 'free' }),
      });
      const data = await res.json();
      setResult(data);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Request failed';
      setResult({ ok: false, error: message });
    } finally {
      setLoading(false);
    }
  }

  async function verifyDeposit() {
    if (!result?.api_key || !txHash || !showDeposit) return;

    setDepositLoading(true);
    setDepositResult(null);

    try {
      const res = await fetch(`${API}/api/keys/${result.api_key}/deposit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tx_hash: txHash, tier: showDeposit }),
      });
      const data = await res.json();
      setDepositResult(data);
      if (data.ok) {
        setResult(prev => prev ? {
          ...prev,
          tier: data.new_tier,
          daily_limit: data.new_daily_limit
        } : null);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Verification failed';
      setDepositResult({ ok: false, error: message });
    } finally {
      setDepositLoading(false);
    }
  }

  function copyKey() {
    if (result?.api_key) {
      navigator.clipboard.writeText(result.api_key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function copyTreasury() {
    navigator.clipboard.writeText(TREASURY);
  }

  const selectedPlan = PLANS.find(p => p.tier === showDeposit);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-[18px] font-semibold text-[#B0E4CC] tracking-tight">
          API Plans
        </h1>
        <p className="text-[11px] text-[#408A71] mt-1">
          RPC access for every scale · USDT deposit on Polygon · Instant activation
        </p>
      </div>

      {/* Plans Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {PLANS.map((plan) => (
          <div
            key={plan.name}
            className={`bg-[#0c1a17] rounded-md overflow-hidden ${
              plan.highlight
                ? 'border-2 border-[#408A71] shadow-[0_0_20px_rgba(64,138,113,0.15)]'
                : 'border border-[#1a3028]'
            }`}
          >
            {plan.highlight && (
              <div className="bg-[#408A71] text-[#091413] text-[9px] font-bold text-center py-1 tracking-wider uppercase">
                Most Popular
              </div>
            )}
            <div className="p-5">
              <p className="text-[11px] text-[#285A48] uppercase tracking-wider mb-1">
                {plan.name}
              </p>
              <p className="text-[28px] font-bold text-[#B0E4CC] leading-none">
                {plan.price}
                <span className="text-[13px] text-[#285A48] font-normal">{plan.period}</span>
              </p>
              <p className="text-[11px] text-[#408A71] mt-1 mb-4">{plan.limit}</p>
              <div className="space-y-1.5 mb-5">
                {plan.features.map((f) => (
                  <p key={f} className="text-[11px] text-[#285A48] flex items-center gap-1.5">
                    <span className="text-[#408A71]">✓</span>
                    {f}
                  </p>
                ))}
              </div>
              {plan.tier === 'free' ? (
                <button
                  onClick={getFreeKey}
                  disabled={loading}
                  className="w-full py-2 bg-[#408A71] text-[#091413] font-semibold text-[12px] rounded hover:bg-[#4fa07f] transition-colors disabled:opacity-40"
                >
                  {loading ? 'Creating...' : plan.cta}
                </button>
              ) : (
                <button
                  onClick={() => {
                    if (!result?.api_key) {
                      getFreeKey();
                    }
                    setShowDeposit(plan.tier);
                    setDepositResult(null);
                    setTxHash('');
                  }}
                  className="w-full py-2 bg-transparent border border-[#285A48] text-[#408A71] font-semibold text-[12px] rounded hover:bg-[#0f2318] hover:border-[#408A71] transition-colors"
                >
                  {plan.cta}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* API Key Result */}
      {result && (
        <div
          className={`rounded-md p-5 ${
            result.ok
              ? 'bg-[#0c2219] border border-[#285A48]'
              : 'bg-[#1a0f0f] border border-[#3e1818]'
          }`}
        >
          {result.ok ? (
            <div>
              <p className="text-[13px] font-semibold text-[#B0E4CC] mb-3">
                ✓ API Key Created
              </p>
              <div className="flex items-center gap-2 mb-3">
                <div className="flex-1 bg-[#091413] rounded p-3 font-mono text-[11px] text-[#00D1FF] break-all">
                  {result.api_key}
                </div>
                <button
                  onClick={copyKey}
                  className="px-3 py-2 bg-[#1a3028] text-[#408A71] text-[11px] rounded hover:bg-[#285A48] hover:text-[#B0E4CC] transition-colors"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <p className="text-[11px] text-[#285A48] mb-3">
                Daily limit: <span className="text-[#408A71]">{result.daily_limit?.toLocaleString()} requests</span> ·
                Tier: <span className="text-[#408A71]">{result.tier}</span>
              </p>

              {/* Deposit Modal */}
              {showDeposit && selectedPlan && (
                <div className="mt-4 p-4 bg-[#091413] border border-[#285A48] rounded">
                  <p className="text-[12px] font-semibold text-[#B0E4CC] mb-3">
                    Activate {selectedPlan.name} Plan — ${selectedPlan.priceUsdt} USDT
                  </p>

                  <div className="space-y-3">
                    <div>
                      <p className="text-[10px] text-[#285A48] mb-1">
                        1. Send {selectedPlan.priceUsdt} USDT to this address on Polygon:
                      </p>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-[#0c1a17] rounded p-2 font-mono text-[10px] text-[#408A71] break-all">
                          {TREASURY}
                        </div>
                        <button
                          onClick={copyTreasury}
                          className="px-2 py-1 bg-[#1a3028] text-[#285A48] text-[10px] rounded hover:text-[#408A71]"
                        >
                          Copy
                        </button>
                      </div>
                    </div>

                    <div className="flex gap-4 text-[10px] text-[#285A48]">
                      <span>Network: <span className="text-[#408A71]">Polygon</span></span>
                      <span>Token: <span className="text-[#408A71]">USDT</span></span>
                      <span>ChainId: <span className="text-[#408A71]">137</span></span>
                    </div>

                    <div>
                      <p className="text-[10px] text-[#285A48] mb-1">
                        2. Paste your transaction hash:
                      </p>
                      <input
                        value={txHash}
                        onChange={(e) => setTxHash(e.target.value)}
                        placeholder="0x..."
                        className="w-full bg-[#0c1a17] border border-[#1a3028] text-[#B0E4CC] text-[11px] font-mono p-2 rounded focus:border-[#285A48] outline-none"
                      />
                    </div>

                    <button
                      onClick={verifyDeposit}
                      disabled={depositLoading || !txHash.startsWith('0x')}
                      className="w-full py-2 bg-[#408A71] text-[#091413] font-semibold text-[12px] rounded hover:bg-[#4fa07f] transition-colors disabled:opacity-40"
                    >
                      {depositLoading ? 'Verifying...' : 'Verify & Activate'}
                    </button>

                    {depositResult && (
                      <div className={`p-3 rounded ${depositResult.ok ? 'bg-[#0f2e1a] border border-[#285A48]' : 'bg-[#1a0f0f] border border-[#3e1818]'}`}>
                        {depositResult.ok ? (
                          <p className="text-[11px] text-[#408A71]">
                            ✅ {depositResult.message}
                          </p>
                        ) : (
                          <p className="text-[11px] text-[#c04040]">
                            ✗ {depositResult.error}
                          </p>
                        )}
                      </div>
                    )}

                    <button
                      onClick={() => setShowDeposit(null)}
                      className="w-full py-1 text-[10px] text-[#285A48] hover:text-[#408A71]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {!showDeposit && (
                <>
                  <div className="bg-[#091413] rounded p-4 mb-3">
                    <p className="text-[10px] text-[#285A48] uppercase tracking-wider mb-2">
                      Usage
                    </p>
                    <p className="text-[11px] text-[#408A71] font-mono">
                      Add header: <span className="text-[#00D1FF]">X-API-Key: {result.api_key?.slice(0, 15)}...</span>
                    </p>
                  </div>

                  <div className="bg-[#091413] rounded p-4">
                    <p className="text-[10px] text-[#285A48] uppercase tracking-wider mb-2">
                      Example cURL
                    </p>
                    <pre className="text-[10px] font-mono text-[#408A71] overflow-x-auto whitespace-pre-wrap">
{`curl -X POST https://rpc.satelink.network/rpc/polygon \\
  -H "X-API-Key: ${result.api_key}" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`}
                    </pre>
                  </div>

                  <div className="mt-4 p-3 bg-[#16140a] border border-[#3a3e18] rounded">
                    <p className="text-[10px] text-[#a0a030]">
                      ⚠ Save this key securely — it cannot be retrieved again
                    </p>
                  </div>
                </>
              )}
            </div>
          ) : (
            <p className="text-[12px] text-[#c04040]">Error: {result.error}</p>
          )}
        </div>
      )}

      {/* Info Box */}
      <div className="bg-[#0c1a17] border border-[#1a3028] rounded-md p-5">
        <p className="text-[11px] font-medium text-[#B0E4CC] mb-3">
          How Deposits Work
        </p>
        <div className="grid grid-cols-4 gap-3 mb-4 text-center">
          {[
            { step: '1', label: 'Create Key', icon: '🔑' },
            { step: '2', label: 'Send USDT', icon: '💸' },
            { step: '3', label: 'Verify TX', icon: '✓' },
            { step: '4', label: 'Upgraded!', icon: '🚀' },
          ].map((s) => (
            <div key={s.step}>
              <p className="text-[16px] mb-1">{s.icon}</p>
              <p className="text-[10px] text-[#285A48]">{s.label}</p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-[#285A48] leading-relaxed">
          Deposit USDT on Polygon to your API key. On-chain verification activates your tier instantly.
          Revenue is split: 50% node operators, 30% platform, 20% distribution pool.
        </p>
      </div>

      {/* Pricing Table */}
      <div className="bg-[#0c1a17] border border-[#1a3028] rounded-md overflow-hidden">
        <div className="px-4 py-3 border-b border-[#1a3028]">
          <p className="text-[12px] font-medium text-[#B0E4CC]">Per-Call Pricing</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#1a3028] bg-[#091413]/50">
                {['Chain', 'Price/Call', 'Example Methods'].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2 text-left text-[9px] font-semibold text-[#285A48] uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { chain: 'Polygon', price: '$0.00003', methods: 'eth_call, eth_blockNumber' },
                { chain: 'Ethereum', price: '$0.00005', methods: 'eth_call, eth_getLogs' },
                { chain: 'Arbitrum', price: '$0.00004', methods: 'eth_call, eth_getBalance' },
                { chain: 'Base', price: '$0.00004', methods: 'eth_call, eth_sendRawTransaction' },
              ].map((row) => (
                <tr key={row.chain} className="border-b border-[#0f1d15] hover:bg-[#0f1e17]">
                  <td className="px-4 py-2 text-[11px] text-[#B0E4CC]">{row.chain}</td>
                  <td className="px-4 py-2 font-mono text-[11px] text-[#00D1FF]">{row.price}</td>
                  <td className="px-4 py-2 text-[10px] text-[#285A48]">{row.methods}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
