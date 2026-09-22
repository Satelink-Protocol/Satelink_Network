"use client";
import React, { useEffect, useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@satelink/ui';
import { Badge } from '@satelink/ui';
import { toast } from 'sonner';
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "https://rpc.satelink.network";
const getAuthHeaders = () => {
  const token = typeof window !== "undefined" ? localStorage.getItem("satelink_token") : "";
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
};
const api = {
  get: async (path: string) => fetch(`${API_BASE}${path}`, { headers: getAuthHeaders() }).then(async r => ({ data: await r.json(), status: r.status, ok: r.ok })),
  post: async (path: string, body?: any) => fetch(`${API_BASE}${path}`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(body) }).then(async r => ({ data: await r.json(), status: r.status, ok: r.ok })),
  delete: async (path: string) => fetch(`${API_BASE}${path}`, { method: 'DELETE', headers: getAuthHeaders() }).then(async r => ({ data: await r.json(), status: r.status, ok: r.ok }))
};


export default function NodeEarningsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await api.get('/node-api/earnings');
        if (res.data?.ok) setData(res.data);
        else setError(res.data?.error || 'Failed to load earnings');
      } catch (err: any) {
        setError(err?.response?.data?.error || 'Failed to load earnings');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleClaim = async (epochId: number) => {
    const eth = (window as any).ethereum;
    if (!eth) {
      toast.error('Connect a wallet to claim rewards');
      return;
    }
    setClaiming(epochId);
    try {
      const ethers = await import('ethers');
      const provider = new ethers.BrowserProvider(eth);
      const signer = await provider.getSigner();
      const wallet = await signer.getAddress();
      const message = `CLAIM_REWARDS:${wallet.toLowerCase()}`;
      const signature = await signer.signMessage(message);
      await api.post('/node-api/claim', { signature });
      toast.success('Claim submitted!');
      setData((prev: any) => ({
        ...prev,
        earnings: prev.earnings.map((e: any) =>
          e.epoch_id === epochId ? { ...e, status: 'CLAIMED' } : e
        ),
      }));
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || 'Claim failed');
    } finally {
      setClaiming(null);
    }
  };

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-zinc-50">Node Earnings</h1>
        <p className="text-sm text-zinc-500 mt-1">Your epoch-by-epoch earnings history</p>
      </div>

      {loading && <p className="text-zinc-500 text-sm">Loading...</p>}
      {error && <div className="text-red-400 text-sm">Error: {error}</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Card className="bg-zinc-900/80 border-zinc-800/60">
              <CardContent className="p-4">
                <p className="text-xs text-zinc-500 uppercase tracking-wider">Total Earned</p>
                <p className="text-xl font-bold text-zinc-100 mt-1">${data.totalEarned}</p>
              </CardContent>
            </Card>
            <Card className="bg-zinc-900/80 border-zinc-800/60">
              <CardContent className="p-4">
                <p className="text-xs text-zinc-500 uppercase tracking-wider">Claimable</p>
                <p className="text-xl font-bold text-emerald-400 mt-1">${data.claimable}</p>
              </CardContent>
            </Card>
            <Card className="bg-zinc-900/80 border-zinc-800/60">
              <CardContent className="p-4">
                <p className="text-xs text-zinc-500 uppercase tracking-wider">Total Records</p>
                <p className="text-xl font-bold text-zinc-100 mt-1">{data.total}</p>
              </CardContent>
            </Card>
          </div>

          <Card className="bg-zinc-900/80 border-zinc-800/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-zinc-300">Earnings History</CardTitle>
            </CardHeader>
            <CardContent>
              {data.earnings?.length === 0 && (
                <p className="text-zinc-500 text-sm py-4 text-center">No earnings records yet.</p>
              )}
              <div className="divide-y divide-zinc-800/60">
                {data.earnings?.map((e: any, i: number) => (
                  <div key={i} className="flex items-center justify-between py-3 gap-3">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-zinc-200">Epoch #{e.epoch_id}</p>
                      <p className="text-xs text-zinc-500">{e.split_type || e.role || '—'}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <p className="text-sm font-bold text-zinc-100">${(e.amount_usdt || 0).toFixed(4)}</p>
                      <Badge className={`text-[10px] ${e.status === 'UNPAID' ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'}`}>
                        {e.status || 'PAID'}
                      </Badge>
                      {e.status === 'UNPAID' && (
                        <button
                          onClick={() => handleClaim(e.epoch_id)}
                          disabled={claiming === e.epoch_id}
                          className="px-3 py-1 text-xs font-medium rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {claiming === e.epoch_id ? 'Claiming…' : 'Claim'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
