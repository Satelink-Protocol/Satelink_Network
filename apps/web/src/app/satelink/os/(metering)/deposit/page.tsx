"use client";

import { useState } from "react";
import {
  Button,
  Input,
  Inline,
  Stack,
  Panel,
  SectionLabel,
  Notice,
  StatusBadge,
} from "@/components/satelink-os";
import { KPICard } from "@satelink/ui";

// P0 revenue-activation panels (own TOKENS design system — see PR notes re: token mismatch)
import { CreditEstimator } from "@/components/deposit/CreditEstimator";
import { WalletBalanceCard } from "@/components/deposit/WalletBalanceCard";
import { DepositHistory } from "@/components/deposit/DepositHistory";
import { WalletProvider } from "@/components/deposit/wallet/WalletProvider";
import { ConnectWalletButton } from "@/components/deposit/wallet/ConnectWalletButton";
import { useAccount } from "wagmi";

const API_BASE = "https://rpc.satelink.network";

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

/**
 * Copy-to-clipboard field — label + monospace value + copy button.
 * Restyled onto Satelink-OS theme tokens; the copy control is the shared Button.
 */
function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Stack gap="sm">
      <SectionLabel>{label}</SectionLabel>
      <div className="flex items-stretch gap-2">
        <code
          className="flex-1 min-w-0 bg-background border border-border rounded-md px-2.5 py-2 font-mono text-[11px] leading-relaxed text-foreground/70 break-all"
        >
          {value}
        </code>
        <Button tone={copied ? "success" : "muted"} size="sm" onClick={handleCopy}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </Stack>
  );
}

export default function DepositPage() {
  return (
    <WalletProvider>
      <DepositPageInner />
    </WalletProvider>
  );
}

function DepositPageInner() {
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [instructions, setInstructions] = useState<DepositInstructions | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Wallet address from the injected connector — null when disconnected, which makes
  // WalletBalanceCard / DepositHistory render their honest "not connected" states.
  const { address } = useAccount();
  const wallet = address ?? null;

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
      const res = await fetch(`${API_BASE}/credits/initiate?amount=${parsed}`);
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      setInstructions(body);
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : "Failed to get deposit instructions"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-background px-5 py-6">
      <div className="max-w-[720px] mx-auto">
        <Stack gap="md">
          {/* Wallet action row — page title/chrome now provided by the OS DashboardShell header */}
          <Inline gap="sm">
            <span style={{ marginLeft: "auto" }}>
              <Inline gap="sm">
                <StatusBadge label="Polygon 137" tone="info" />
                <ConnectWalletButton />
              </Inline>
            </span>
          </Inline>

          {/* P0 — capacity estimator (shares the amount state with the deposit flow below) */}
          <CreditEstimator
            amount={parseFloat(amount) || 0}
            onAmountChange={(n) => setAmount(Number.isFinite(n) ? String(n) : "")}
          />

          {/* P0 — trust + economics panels */}
          <WalletBalanceCard wallet={wallet} />

          {/* AMOUNT INPUT */}
          <Panel title="Amount">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleGetInstructions();
              }}
            >
              <Stack gap="sm">
                <SectionLabel>USDT Amount</SectionLabel>
                <Inline gap="sm">
                  <Input
                    mono
                    value={amount}
                    onChange={setAmount}
                    placeholder="e.g. 10.00"
                    ariaLabel="USDT amount"
                    disabled={loading}
                  />
                  <Button
                    tone="primary"
                    onClick={handleGetInstructions}
                    disabled={loading}
                  >
                    {loading ? "Loading…" : "Get deposit instructions"}
                  </Button>
                </Inline>
                {error && <Notice tone="danger">{error}</Notice>}
              </Stack>
            </form>
          </Panel>

          {/* DEPOSIT INSTRUCTIONS */}
          {instructions && (
            <>
              {/* SUMMARY */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2">
                <KPICard label="Chain"
 value={`Polygon (${instructions.chainId})`}
 caption="Polygon PoS Mainnet"
 />
                <KPICard label="Deposit Amount"
 value={`${instructions.amountUsdt} USDT`}
 caption="To RevenueVault"
 />
              </div>

              {/* ADDRESSES */}
              <Panel title="Contract Addresses">
                <Stack gap="md">
                  <CopyField
                    label="RevenueVault Address"
                    value={instructions.revenueVaultAddress}
                  />
                  <CopyField
                    label="USDT Contract Address"
                    value={instructions.usdtAddress}
                  />
                </Stack>
              </Panel>

              {/* STEP 1 */}
              <Panel
                title="Step 1 — Approve USDT to RevenueVault"
                headerRight={<StatusBadge label="Step 1" tone="muted" />}
              >
                <Stack gap="sm">
                  <p className="text-[11px] text-muted-foreground m-0">
                    Send to:{" "}
                    <span className="font-mono text-foreground/70">
                      {instructions.usdtAddress}
                    </span>
                  </p>
                  <CopyField label="Approve Calldata" value={instructions.approveCalldata} />
                </Stack>
              </Panel>

              {/* STEP 2 */}
              <Panel
                title="Step 2 — Deposit USDT into RevenueVault"
                headerRight={<StatusBadge label="Step 2" tone="primary" />}
              >
                <Stack gap="sm">
                  <p className="text-[11px] text-muted-foreground m-0">
                    Send to:{" "}
                    <span className="font-mono text-foreground/70">
                      {instructions.revenueVaultAddress}
                    </span>
                  </p>
                  <CopyField label="Deposit Calldata" value={instructions.depositCalldata} />
                </Stack>
              </Panel>

              {/* HOW TO EXECUTE */}
              <Panel title="How to execute">
                <Stack gap="sm">
                  <p className="text-xs text-foreground/70 m-0">
                    Use any EVM wallet or web3 tool to execute these two transactions.
                  </p>
                  <p className="text-[11px] text-muted-foreground m-0">
                    After both transactions confirm, your credits will be available. Add{" "}
                    <code className="font-mono bg-background px-1 py-[1px] rounded text-foreground">
                      X-Wallet-Address: &lt;your-wallet&gt;
                    </code>{" "}
                    to your RPC calls to claim earnings.
                  </p>
                  <div>
                    <a
                      href={instructions.polygonscan}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-primary underline underline-offset-2"
                    >
                      View vault on Polygonscan →
                    </a>
                  </div>
                </Stack>
              </Panel>

              {/* WHAT HAPPENS NEXT */}
              <Panel title="What happens next">
                <Stack gap="sm">
                  <ol className="m-0 pl-[18px] flex flex-col gap-2 text-xs text-foreground/70 leading-relaxed">
                    <li>
                      Credits appear automatically within{" "}
                      <strong className="text-green-400">~30 seconds</strong> of
                      transaction confirmation (2 Polygon blocks).
                    </li>
                    <li>
                      Add{" "}
                      <code className="font-mono bg-background px-1 py-[1px] rounded text-foreground">
                        X-Wallet-Address: &lt;your-wallet&gt;
                      </code>{" "}
                      to every RPC request so calls are billed to your balance.
                    </li>
                    <li>
                      Each call costs{" "}
                      <strong className="text-green-400">$0.00003 USDT</strong> —
                      33,333 calls per $1 deposited.
                    </li>
                  </ol>
                  <div>
                    <a
                      href="/satelink/os/overview"
                      className="text-xs font-semibold text-primary no-underline"
                    >
                      Open the console →
                    </a>
                  </div>
                </Stack>
              </Panel>
            </>
          )}

          {/* P0 — deposit history (renders only when a wallet is connected; null here = honest empty) */}
          <DepositHistory wallet={wallet} />
        </Stack>
      </div>
    </div>
  );
}
