// apps/web/src/app/intelligence/success/page.tsx
//
// T-1.4: Dodo redirects here after checkout (return_url set by
// /api/dodo-checkout, `?account=<api_key>`). The webhook that actually
// credits the account is a separate, asynchronous delivery from Dodo — it
// can land a few seconds after this redirect — so this page polls balance
// instead of assuming the credit already landed.
"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "https://api.satelink.network";
const POLL_MS = 3000;
const MAX_POLLS = 20; // ~1 minute

type Balance = {
  balance_usdt: number;
  status: "funded" | "empty";
};

function maskKey(key: string): string {
  if (key.length <= 12) return key;
  return `${key.slice(0, 10)}${"•".repeat(8)}${key.slice(-4)}`;
}

function SuccessContent() {
  const params = useSearchParams();
  const apiKey = params.get("account") || "";
  const [balance, setBalance] = useState<Balance | null>(null);
  const [copied, setCopied] = useState(false);
  const [polls, setPolls] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!apiKey) {
      setError("Missing account reference — check your email for the receipt, or contact support.");
      return;
    }
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`${API_BASE}/credits/balance?apiKey=${encodeURIComponent(apiKey)}`);
        if (res.ok) {
          const data = (await res.json()) as Balance;
          if (!cancelled) setBalance(data);
        }
      } catch {
        // network hiccup — the interval will retry
      } finally {
        if (!cancelled) setPolls((p) => p + 1);
      }
    }
    poll();
    const id = setInterval(() => {
      if (polls >= MAX_POLLS) {
        clearInterval(id);
        return;
      }
      poll();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  const funded = balance?.status === "funded";
  const stillWaiting = !!apiKey && !funded && polls < MAX_POLLS;
  const timedOut = !!apiKey && !funded && polls >= MAX_POLLS;

  function copy() {
    navigator.clipboard.writeText(apiKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <p className="text-sm font-medium text-muted-foreground">Satelink Intelligence</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        {funded ? "You're funded" : "Payment received"}
      </h1>

      {error && <p className="mt-4 text-sm text-red-500">{error}</p>}

      {apiKey && (
        <>
          <p className="mt-4 text-sm text-muted-foreground">
            Your API key — save this now, it is shown only once:
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded border border-border bg-muted/30 px-3 py-2 text-xs">
              {apiKey}
            </code>
            <button
              onClick={copy}
              className="rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-muted/30"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          <div className="mt-6 rounded-md border border-border bg-muted/30 px-4 py-3 text-sm">
            {funded && balance && (
              <p className="text-foreground">
                Balance: <span className="font-medium">${balance.balance_usdt.toFixed(2)}</span> USD credits
              </p>
            )}
            {stillWaiting && (
              <p className="text-muted-foreground">
                Waiting for your payment to be confirmed — this usually takes a few seconds…
              </p>
            )}
            {timedOut && (
              <p className="text-muted-foreground">
                Still not confirmed after a minute. Your payment went through, but crediting is delayed —
                it will land shortly, or contact support with this key if it doesn't.
              </p>
            )}
          </div>

          <p className="mt-6 text-xs text-muted-foreground">
            Use this key as <code className="rounded bg-muted/30 px-1">X-API-Key</code> on any{" "}
            <code className="rounded bg-muted/30 px-1">/v1/intelligence/*</code> or{" "}
            <code className="rounded bg-muted/30 px-1">/rpc/*</code> request. See{" "}
            <a href="https://docs.satelink.network" className="underline">
              docs.satelink.network
            </a>{" "}
            for the full reference.
          </p>
        </>
      )}
    </div>
  );
}

export default function IntelligenceSuccessPage() {
  return (
    <Suspense fallback={null}>
      <SuccessContent />
    </Suspense>
  );
}
