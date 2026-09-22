// apps/web/src/app/intelligence/success/page.tsx
//
// T-1.4: Dodo redirects here after checkout (return_url set by
// /api/dodo-checkout, `?claim=<one-time token>` — NEVER the api_key itself,
// see /api/dodo-claim's header comment for why). This page exchanges that
// token exactly once for the key, holds it only in React state, and never
// places it in a URL, browser history, or a cross-origin request — balance
// polling goes through /api/dodo-balance (a same-origin server-side proxy)
// with the key in a POST body, not a query string.
//
// The webhook that actually credits the account is a separate, asynchronous
// delivery from Dodo — it can land a few seconds after this redirect — so
// this page polls balance instead of assuming the credit already landed.
"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

const POLL_MS = 3000;
const MAX_POLLS = 20; // ~1 minute

type Balance = {
  balance_usdt: number;
  status: "funded" | "empty";
};

async function exchangeClaim(claimToken: string): Promise<string> {
  const res = await fetch("/api/dodo-claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ claimToken }),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; apiKey?: string };
  if (!res.ok || !data.apiKey) {
    throw new Error(res.status === 410 ? "expired" : "failed");
  }
  return data.apiKey;
}

async function fetchBalance(apiKey: string): Promise<Balance | null> {
  const res = await fetch("/api/dodo-balance", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as Balance & { ok?: boolean };
  return data;
}

function SuccessContent() {
  const params = useSearchParams();
  const claimToken = params.get("claim") || "";
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [copied, setCopied] = useState(false);
  const [polls, setPolls] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const exchangedRef = useRef(false);

  // Exchange the claim token exactly once — StrictMode/fast-refresh can
  // mount this effect twice in dev, so a ref guards against a double POST
  // (the token is single-use server-side too, but this avoids a spurious
  // "expired" error on the second call in dev).
  useEffect(() => {
    if (!claimToken) {
      setError("Missing claim reference — check your email for the receipt, or contact support.");
      return;
    }
    if (exchangedRef.current) return;
    exchangedRef.current = true;
    exchangeClaim(claimToken)
      .then(setApiKey)
      .catch(() => setError("This claim link is invalid or has expired — contact support with your payment receipt."));
  }, [claimToken]);

  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;
    async function poll() {
      const data = await fetchBalance(apiKey!);
      if (!cancelled && data) setBalance(data);
      if (!cancelled) setPolls((p) => p + 1);
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
    if (!apiKey) return;
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
