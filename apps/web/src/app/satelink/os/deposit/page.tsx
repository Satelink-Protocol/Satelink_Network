"use client";

import { useState } from "react";
import api from "@/lib/api";

interface DepositInstructions {
  revenueVaultAddress: string;
  usdtAddress: string;
  chainId: number;
  amountUsdt: number;
  amountRaw: string;
  approveCalldata: string;
  depositCalldata: string;
  network: string;
  polygonscan: string;
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-1">
      <p className="text-[10px] text-[#285A48] uppercase tracking-wider">{label}</p>
      <div className="flex items-start gap-2">
        <code className="flex-1 bg-[#091413] border border-[#1a3028] rounded px-3 py-2 font-mono text-[11px] text-[#B0E4CC] break-all">
          {value}
        </code>
        <button
          onClick={handleCopy}
          className="shrink-0 px-3 py-2 bg-[#1a3028] hover:bg-[#285A48] text-[#408A71] hover:text-[#B0E4CC] text-[10px] font-semibold rounded transition-colors"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export default function DepositPage() {
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [instructions, setInstructions] = useState<DepositInstructions | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGetInstructions = async () => {
    const parsed = parseFloat(amount);
    if (!amount || isNaN(parsed) || parsed <= 0) {
      setError("Enter a valid USDT amount");
      return;
    }

    setLoading(true);
    setError(null);
    setInstructions(null);

    try {
      const res = await api.get(`/credits/initiate?amount=${parsed}`);
      setInstructions(res.data);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        "Failed to get deposit instructions";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#091413] font-['Inter',sans-serif] text-[#B0E4CC]">
      {/* TOP BAR */}
      <div className="sticky top-0 z-50 flex items-center h-12 px-4 gap-4 border-b border-[#1a3028] bg-[#091413]/95 backdrop-blur-sm">
        <div className="flex items-center gap-2 text-[13px] font-semibold">
          <div className="w-2 h-2 rounded-full bg-[#00D1FF] animate-pulse" />
          DEPOSIT USDT
        </div>
        <div className="ml-auto">
          <span className="text-[9px] px-2 py-0.5 rounded border border-[#00D1FF] text-[#00D1FF] font-mono">
            POLYGON 137
          </span>
        </div>
      </div>

      <div className="p-5 max-w-2xl space-y-4">
        {/* AMOUNT INPUT */}
        <div className="bg-[#0c1a17] border border-[#1a3028] rounded-md p-4">
          <label className="text-[10px] text-[#285A48] uppercase tracking-wider block mb-2">
            USDT Amount
          </label>
          <div className="flex gap-2">
            <input
              type="number"
              min="0"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleGetInstructions()}
              placeholder="e.g. 10.00"
              className="flex-1 bg-[#091413] border border-[#1a3028] rounded px-3 py-2 font-mono text-[13px] text-[#B0E4CC] focus:border-[#408A71] focus:outline-none"
            />
            <button
              onClick={handleGetInstructions}
              disabled={loading}
              className="px-4 py-2 bg-[#285A48] hover:bg-[#408A71] disabled:bg-[#1a3028] disabled:text-[#285A48] text-[#091413] text-[11px] font-semibold rounded transition-colors"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-3 h-3 border-2 border-[#091413]/40 border-t-[#091413] rounded-full animate-spin" />
                  Loading...
                </span>
              ) : (
                "Get deposit instructions"
              )}
            </button>
          </div>
          {error && (
            <p className="mt-2 text-[11px] text-[#c04040]">{error}</p>
          )}
        </div>

        {/* DEPOSIT INSTRUCTIONS */}
        {instructions && (
          <>
            {/* ADDRESSES */}
            <div className="bg-[#0c1a17] border border-[#1a3028] rounded-md p-4 space-y-4">
              <p className="text-[10px] text-[#285A48] uppercase tracking-wider font-semibold">
                Contract Addresses
              </p>
              <CopyField label="RevenueVault Address" value={instructions.revenueVaultAddress} />
              <CopyField label="USDT Contract Address" value={instructions.usdtAddress} />
              <div className="flex gap-6 pt-1 text-[10px]">
                <div>
                  <span className="text-[#285A48]">Chain</span>
                  <span className="ml-2 font-mono text-[#00D1FF]">Polygon ({instructions.chainId})</span>
                </div>
                <div>
                  <span className="text-[#285A48]">Amount</span>
                  <span className="ml-2 font-mono text-[#B0E4CC]">{instructions.amountUsdt} USDT</span>
                </div>
              </div>
            </div>

            {/* STEP 1 */}
            <div className="bg-[#0c1a17] border border-[#1a3028] rounded-md p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-[9px] px-2 py-0.5 rounded bg-[#1a3028] text-[#408A71] font-mono font-semibold">
                  STEP 1
                </span>
                <p className="text-[12px] font-medium text-[#B0E4CC]">Approve USDT to RevenueVault</p>
              </div>
              <p className="text-[10px] text-[#285A48]">
                Send to: <span className="font-mono text-[#408A71]">{instructions.usdtAddress}</span>
              </p>
              <CopyField label="Approve Calldata" value={instructions.approveCalldata} />
            </div>

            {/* STEP 2 */}
            <div className="bg-[#0c1a17] border border-[#285A48] rounded-md p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-[9px] px-2 py-0.5 rounded bg-[#285A48] text-[#091413] font-mono font-semibold">
                  STEP 2
                </span>
                <p className="text-[12px] font-medium text-[#B0E4CC]">Deposit USDT into RevenueVault</p>
              </div>
              <p className="text-[10px] text-[#285A48]">
                Send to: <span className="font-mono text-[#408A71]">{instructions.revenueVaultAddress}</span>
              </p>
              <CopyField label="Deposit Calldata" value={instructions.depositCalldata} />
            </div>

            {/* INSTRUCTIONS */}
            <div className="bg-[#0c1a17] border border-[#1a3028] rounded-md p-4">
              <p className="text-[11px] text-[#408A71]">
                Use any EVM wallet or web3 tool to execute these two transactions
              </p>
              <p className="text-[10px] text-[#285A48] mt-2">
                After both transactions confirm, your credits will be available.
                Add <code className="font-mono bg-[#091413] px-1 rounded">X-Wallet-Address: &lt;your-wallet&gt;</code> to your RPC calls to claim earnings.
              </p>
              <a
                href={instructions.polygonscan}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-3 text-[10px] text-[#285A48] hover:text-[#408A71] underline underline-offset-2"
              >
                View vault on Polygonscan →
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
