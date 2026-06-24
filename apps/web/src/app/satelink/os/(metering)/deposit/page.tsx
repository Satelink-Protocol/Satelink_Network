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
import { KPIGrid, StatCard } from "@satelink/ui";

// P0 revenue-activation panels (own TOKENS design system — see PR notes re: token mismatch)
import { CreditEstimator } from "@/components/deposit/CreditEstimator";
import { WalletBalanceCard } from "@/components/deposit/WalletBalanceCard";
import { RevenueVaultProofCard } from "@/components/deposit/RevenueVaultProofCard";
import { PricingEconomicsCard } from "@/components/deposit/PricingEconomicsCard";
import { NetworkStatsWidget } from "@/components/deposit/NetworkStatsWidget";
import { DepositHistory } from "@/components/deposit/DepositHistory";
import { FundingWorkflow } from "@/components/deposit/FundingWorkflow";
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
      <div style={{ display: "flex", alignItems: "stretch", gap: "8px" }}>
        <code
          style={{
            flex: 1,
            minWidth: 0,
            background: "var(--sat-bg-0)",
            border: "1px solid var(--sat-border)",
            borderRadius: "var(--sat-radius-md)",
            padding: "8px 10px",
            fontFamily: "var(--sat-font-mono)",
            fontSize: "11px",
            lineHeight: 1.5,
            color: "var(--sat-text-secondary)",
            wordBreak: "break-all",
          }}
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
    <div
      style={{
        background: "var(--sat-bg-0)",
        padding: "24px 20px",
      }}
    >
      <div style={{ maxWidth: "720px", margin: "0 auto" }}>
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

          {/* Value proposition (copy only) */}
          <ul
            style={{
              margin: 0,
              paddingLeft: 18,
              display: "flex",
              flexDirection: "column",
              gap: 4,
              fontSize: 12,
              color: "var(--sat-text-secondary)",
              lineHeight: 1.5,
            }}
          >
            <li>Pay-as-you-go — buy exactly the capacity you need</li>
            <li>No subscriptions</li>
            <li>No monthly commitments</li>
            <li>Credits never expire</li>
            <li>Machine-to-machine billing — per-call, fully programmatic</li>
            <li>On-chain USDT settlement on Polygon</li>
          </ul>

          {/* P0 — funding lifecycle (static, above the fold) */}
          <FundingWorkflow />

          {/* P0 — capacity estimator (shares the amount state with the deposit flow below) */}
          <CreditEstimator
            amount={parseFloat(amount) || 0}
            onAmountChange={(n) => setAmount(Number.isFinite(n) ? String(n) : "")}
          />

          {/* P0 — trust + economics panels */}
          <WalletBalanceCard wallet={wallet} />
          <RevenueVaultProofCard />
          <PricingEconomicsCard />
          <NetworkStatsWidget />

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
              <KPIGrid columns={2}>
                <StatCard label="Chain"
 value={`Polygon (${instructions.chainId})`}
 caption="Polygon PoS Mainnet"
 />
                <StatCard label="Deposit Amount"
 value={`${instructions.amountUsdt} USDT`}
 caption="To RevenueVault"
 accent />
              </KPIGrid>

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
                  <p style={{ fontSize: "11px", color: "var(--sat-text-muted)", margin: 0 }}>
                    Send to:{" "}
                    <span
                      style={{
                        fontFamily: "var(--sat-font-mono)",
                        color: "var(--sat-text-secondary)",
                      }}
                    >
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
                  <p style={{ fontSize: "11px", color: "var(--sat-text-muted)", margin: 0 }}>
                    Send to:{" "}
                    <span
                      style={{
                        fontFamily: "var(--sat-font-mono)",
                        color: "var(--sat-text-secondary)",
                      }}
                    >
                      {instructions.revenueVaultAddress}
                    </span>
                  </p>
                  <CopyField label="Deposit Calldata" value={instructions.depositCalldata} />
                </Stack>
              </Panel>

              {/* HOW TO EXECUTE */}
              <Panel title="How to execute">
                <Stack gap="sm">
                  <p style={{ fontSize: "12px", color: "var(--sat-text-secondary)", margin: 0 }}>
                    Use any EVM wallet or web3 tool to execute these two transactions.
                  </p>
                  <p style={{ fontSize: "11px", color: "var(--sat-text-muted)", margin: 0 }}>
                    After both transactions confirm, your credits will be available. Add{" "}
                    <code
                      style={{
                        fontFamily: "var(--sat-font-mono)",
                        background: "var(--sat-bg-0)",
                        padding: "1px 5px",
                        borderRadius: "var(--sat-radius-sm)",
                        color: "var(--sat-secondary)",
                      }}
                    >
                      X-Wallet-Address: &lt;your-wallet&gt;
                    </code>{" "}
                    to your RPC calls to claim earnings.
                  </p>
                  <div>
                    <a
                      href={instructions.polygonscan}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: "11px",
                        color: "var(--sat-primary)",
                        textDecoration: "underline",
                        textUnderlineOffset: "2px",
                      }}
                    >
                      View vault on Polygonscan →
                    </a>
                  </div>
                </Stack>
              </Panel>

              {/* WHAT HAPPENS NEXT */}
              <Panel title="What happens next">
                <Stack gap="sm">
                  <ol
                    style={{
                      margin: 0,
                      paddingLeft: "18px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                      fontSize: "12px",
                      color: "var(--sat-text-secondary)",
                      lineHeight: 1.5,
                    }}
                  >
                    <li>
                      Credits appear automatically within{" "}
                      <strong style={{ color: "var(--sat-success)" }}>~30 seconds</strong> of
                      transaction confirmation (2 Polygon blocks).
                    </li>
                    <li>
                      Add{" "}
                      <code
                        style={{
                          fontFamily: "var(--sat-font-mono)",
                          background: "var(--sat-bg-0)",
                          padding: "1px 5px",
                          borderRadius: "var(--sat-radius-sm)",
                          color: "var(--sat-secondary)",
                        }}
                      >
                        X-Wallet-Address: &lt;your-wallet&gt;
                      </code>{" "}
                      to every RPC request so calls are billed to your balance.
                    </li>
                    <li>
                      Each call costs{" "}
                      <strong style={{ color: "var(--sat-success)" }}>$0.00003 USDT</strong> —
                      33,333 calls per $1 deposited.
                    </li>
                  </ol>
                  <div>
                    <a
                      href="/satelink/os/overview"
                      style={{
                        fontSize: "12px",
                        fontWeight: 600,
                        color: "var(--sat-primary)",
                        textDecoration: "none",
                      }}
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
