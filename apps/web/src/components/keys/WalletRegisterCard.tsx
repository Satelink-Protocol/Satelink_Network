"use client";

/**
 * One-click "Get API Key" — the frictionless developer onboarding path.
 *
 * Connect MetaMask → sign the EIP-191 registration message → POST
 * /v1/machine/register → API key. No terminal, no manual signature crafting,
 * no copy-pasting wallet addresses. The signature proves wallet ownership so
 * on-chain USDT deposits from that wallet auto-credit this key's account.
 *
 * Self-wraps in WalletProvider so the keys page needs no provider changes.
 */

import { useState } from "react";
import { KeyRound, Wallet } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Button,
} from "@satelink/ui";
import { useAccount, useConnect, useDisconnect, useSignMessage } from "wagmi";
import { injected } from "wagmi/connectors";
import { WalletProvider } from "@/components/deposit/wallet/WalletProvider";
import {
  registrationMessage,
  registrationFor,
  saveWalletRegistration,
} from "@/lib/wallet-registration";

interface RegisterResponse {
  ok?: boolean;
  api_key?: string;
  tier?: string;
  daily_limit?: number;
  error?: string;
  message?: string;
}

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function WalletRegisterCardInner({
  onRegistered,
}: {
  onRegistered: (apiKey: string, wallet: string) => void;
}) {
  const { address, isConnected } = useAccount();
  const { connect, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const hasInjected =
    typeof window !== "undefined" &&
    (window as { ethereum?: unknown }).ethereum !== undefined;

  const handleRegister = async () => {
    if (!address) return;
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      // MetaMask signature prompt — the only user action in the whole flow.
      const signature = await signMessageAsync({
        message: registrationMessage(address),
      });
      const res = await fetch("/v1/machine/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet_address: address, signature }),
      });
      const body = (await res.json()) as RegisterResponse;

      if (res.status === 201 && body.api_key) {
        saveWalletRegistration(address, body.api_key);
        onRegistered(body.api_key, address);
        setInfo(`Registered wallet ${short(address)} — free tier, ${body.daily_limit ?? 500} calls/day. Deposit USDT from this wallet to buy paid capacity.`);
        return;
      }
      if (res.status === 409) {
        // One account per wallet — key was issued once at registration.
        const local = registrationFor(address);
        if (local) {
          onRegistered(local.apiKey, address);
          setInfo(`This wallet is already registered — restored its API key from this browser.`);
        } else {
          setError(
            `Wallet ${short(address)} already has an account, and its API key can only be shown once at registration. ` +
            `Use the key you saved, or connect a different wallet.`
          );
        }
        return;
      }
      throw new Error(body.message || body.error || `HTTP ${res.status}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Registration failed";
      // wagmi surfaces MetaMask rejection as a long error string — keep it human.
      setError(/denied|rejected/i.test(msg) ? "Signature request was declined in MetaMask." : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="glow-card glass-panel border-primary/30 bg-primary/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4" /> Get API Key
        </CardTitle>
        <CardDescription>
          Connect MetaMask and sign one message — no terminal, no manual steps.
          Your key is bound to your wallet, so USDT deposits from it credit your
          account automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!hasInjected && (
          <p className="text-xs text-muted-foreground">
            No browser wallet detected. Install{" "}
            <a href="https://metamask.io" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
              MetaMask
            </a>{" "}
            to continue, or register from a machine via{" "}
            <code className="font-mono text-[11px]">POST /v1/machine/register</code>.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {!isConnected ? (
            <Button
              variant="primary"
              onClick={() => connect({ connector: injected() })}
              disabled={connecting || !hasInjected}
            >
              <Wallet className="size-4 mr-2" />
              {connecting ? "Connecting…" : "Connect MetaMask"}
            </Button>
          ) : (
            <>
              <Button variant="primary" onClick={handleRegister} disabled={busy}>
                <KeyRound className="size-4 mr-2" />
                {busy ? "Waiting for signature…" : "Get API Key — Sign with MetaMask"}
              </Button>
              <span className="font-mono text-xs text-muted-foreground">
                {address ? short(address) : ""}
              </span>
              <Button variant="ghost" size="xs" onClick={() => disconnect()}>
                Disconnect
              </Button>
            </>
          )}
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        {info && <p className="text-xs text-success">{info}</p>}
      </CardContent>
    </Card>
  );
}

export function WalletRegisterCard(props: {
  onRegistered: (apiKey: string, wallet: string) => void;
}) {
  return (
    <WalletProvider>
      <WalletRegisterCardInner {...props} />
    </WalletProvider>
  );
}
