// apps/web/src/app/intelligence/CreditPackCard.tsx
// Client component: the interactive half of a credit-pack tier card. Needs
// "use client" (state + fetch), so it's split out of the otherwise-static
// server-rendered /intelligence page.
"use client";

import { useState } from "react";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function CreditPackCard({
  productId,
  label,
  usdValue,
}: {
  productId: string;
  label: string;
  usdValue: number;
}) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function buy() {
    setError(null);
    if (!EMAIL_RE.test(email)) {
      setError("Enter a valid email");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/dodo-checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, productId }),
      });
      const data = await res.json();
      if (!res.ok || !data?.checkoutUrl) {
        setError("Could not start checkout — try again in a moment");
        setLoading(false);
        return;
      }
      window.location.href = data.checkoutUrl;
    } catch {
      setError("Network error — try again");
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col rounded-lg border border-border p-6">
      <h3 className="text-sm font-medium text-muted-foreground">{label}</h3>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-2xl font-semibold">${usdValue.toFixed(2)}</span>
        <span className="text-sm text-muted-foreground">one-time</span>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        ${usdValue.toFixed(2)} in API credits, spendable on any metered call — no subscription, no expiry.
      </p>
      <div className="mt-6 space-y-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          disabled={loading}
        />
        <button
          onClick={buy}
          disabled={loading}
          className="block w-full rounded-md bg-foreground px-4 py-2 text-center text-sm font-medium text-background disabled:opacity-50"
        >
          {loading ? "Starting checkout…" : "Buy with Dodo"}
        </button>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    </div>
  );
}
