"use client";
import React, { useEffect, useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@satelink/ui';
import { Button } from '@satelink/ui';
import { Badge } from '@satelink/ui';
import { Loader2, DollarSign, Wallet, CheckCircle, ShieldAlert, Clock } from 'lucide-react';
// Usually we'd import ethers or viem to interact with the wallet for EVM integration.
// Assuming we use ethers and have a provider available in the window or similar for production
import { ethers } from 'ethers';
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


// Hardcoded for MVP Phase 3
const CLAIMS_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CLAIMS_CONTRACT || "0x0000000000000000000000000000000000000000";

const CLAIMS_ABI = [
  "function claim(uint256 epochId, uint256 amount, bytes32[] calldata merkleProof) external",
  "function withdraw(bytes32 claimId, uint256 amount) external",
  "function availableBalances(address user) external view returns (uint256)"
];

export default function NodeClaimPage() {
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claimData, setClaimData] = useState<any>(null);
  const [availableBalance, setAvailableBalance] = useState<string>("0");
  const [epochIdToClaim, setEpochIdToClaim] = useState<number>(1); // MVP Default

  // Connected EVM state
  const [walletAddress, setWalletAddress] = useState<string>('');
  const [provider, setProvider] = useState<ethers.providers.Web3Provider | null>(null);

  useEffect(() => {
    initWallet();
  }, []);

  const initWallet = async () => {
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      try {
        const browserProvider = new ethers.providers.Web3Provider((window as any).ethereum);
        setProvider(browserProvider);
        const accounts = await browserProvider.send("eth_requestAccounts", []);
        if (accounts.length > 0) {
          setWalletAddress(accounts[0]);
          await fetchAvailableBalance(accounts[0], browserProvider);
        }
      } catch (err) {
        console.error("Failed to connect wallet", err);
      }
    }
    setFetching(false);
  };

  const fetchAvailableBalance = async (address: string, prov: ethers.providers.Web3Provider) => {
    try {
      const contract = new ethers.Contract(CLAIMS_CONTRACT_ADDRESS, CLAIMS_ABI, prov);
      const bal = await contract.availableBalances(address);
      setAvailableBalance(ethers.utils.formatUnits(bal, 6)); // USDT is 6 decimals
    } catch (e) {
      console.error("Error fetching balance from SC", e);
    }
  };

  const fetchProof = async () => {
    setFetching(true);
    setError(null);
    try {
      const res = await api.post('/node/me/claim', { epochId: epochIdToClaim });
      if (res.data.ok) {
        setClaimData(res.data.claim);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to fetch claim data");
      setClaimData(null);
    } finally {
      setFetching(false);
    }
  };

  const executeClaim = async () => {
    if (!provider || !claimData) return;
    setLoading(true);
    setError(null);
    try {
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(CLAIMS_CONTRACT_ADDRESS, CLAIMS_ABI, signer);

      const tx = await contract.claim(claimData.epochId, claimData.amount, JSON.parse(claimData.proof));
      await tx.wait(1);

      alert(`Claim successful! Tx Hash: ${tx.hash}`);
      await fetchAvailableBalance(walletAddress, provider);
    } catch (err: any) {
      setError(err.message || "Smart contract execution failed");
    } finally {
      setLoading(false);
    }
  };

  // Withdrawal functionality is not yet implemented on the backend
  // The smart contract withdraw flow requires a proper claimId fetching endpoint
  const withdrawalEnabled = false;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Node Operator Claims</h1>
          <p className="text-zinc-400 text-sm">Withdraw your earnings directly from the Fuse EVM Smart Contract</p>
        </div>
        {walletAddress ? (
          <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            Connected: {walletAddress.substring(0, 6)}...{walletAddress.substring(38)}
          </Badge>
        ) : (
          <Button onClick={initWallet} variant="outline" size="sm">Connect Wallet</Button>
        )}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-500 px-4 py-3 rounded-lg flex items-center gap-2">
          <ShieldAlert className="w-4 h-4" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-lg">Unclaimed Epoch Rewards</CardTitle>
            <CardDescription>Fetch crypto-graphic proof for an epoch to claim</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <input
                type="number"
                value={epochIdToClaim}
                onChange={(e) => setEpochIdToClaim(Number(e.target.value))}
                className="bg-zinc-950 border border-zinc-800 text-white rounded px-3 py-2 w-full"
                placeholder="Epoch ID"
              />
              <Button onClick={fetchProof} disabled={fetching} variant="secondary">
                {fetching ? <Loader2 className="w-4 h-4 animate-spin" /> : "Check"}
              </Button>
            </div>

            {claimData && (
              <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-lg">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-zinc-400">Epoch {claimData.epochId} Entitlement:</span>
                  <span className="text-lg font-bold text-emerald-400">
                    ${(Number(claimData.amount) / 10 ** 6).toFixed(2)} USDT
                  </span>
                </div>
                <p className="text-xs text-zinc-500 mb-4 break-words">Proof: {claimData.proof.substring(0, 40)}...</p>
                <Button
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white"
                  onClick={executeClaim}
                  disabled={loading || !walletAddress}
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle className="w-4 h-4 mr-2" />}
                  Submit Claim (On-Chain)
                </Button>
                <p className="text-xs text-center text-zinc-500 mt-2">Registers your claim onto the smart contract (48-day lock expiry enforced)</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Wallet className="w-5 h-5 text-blue-400" />
              Claimed Balance (Withdrawable)
            </CardTitle>
            <CardDescription>Funds successfully claimed on-chain</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-4xl font-bold tracking-tight text-white mb-2">
              ${Number(availableBalance).toFixed(2)} <span className="text-lg text-zinc-500 font-normal">USDT</span>
            </div>
            <p className="text-sm text-zinc-400 mb-4">
              You can withdraw your funds as long as the Treasury Vault has sufficient liquidity.
            </p>
            <Button
              className="w-full"
              disabled={true}
              variant="secondary"
            >
              <Clock className="w-4 h-4 mr-2" />
              Withdrawal Coming Soon
            </Button>
            <p className="text-xs text-center text-zinc-500 mt-2">
              On-chain withdrawal will be enabled after smart contract audit completion.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
