"use client";
// CheckoutForm — the interactive checkout. Steps: 1 Account (email) →
// 2 Review (summary + disclosures + consent) → 3 Pay (redirect to Dodo).
// Posts to the EXISTING /api/dodo-checkout; that route mints the claim token
// and returns a Dodo checkout_url we redirect to. Double-submit guarded;
// errors are inline and retryable. Never displays or grants credits here.
import * as React from "react";
import Link from "next/link";
import { ArrowRight, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Checkbox } from "@/components/ui/Field";
import { Stepper } from "@/components/ui/Stepper";
import { Disclosure } from "@/components/ui/Disclosure";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function CheckoutForm({
  productId,
  usdValue,
  label,
  configured,
}: {
  productId: string | null;
  usdValue: number;
  label: string;
  configured: boolean;
}) {
  const [step, setStep] = React.useState<1 | 2>(1);
  const [email, setEmail] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [consent, setConsent] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const emailValid = EMAIL_RE.test(email);
  const price = `$${usdValue.toFixed(2)}`;

  async function pay() {
    if (!configured || !productId || !emailValid || !consent || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dodo-checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), productId }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; checkoutUrl?: string };
      if (!res.ok || !data.checkoutUrl) {
        throw new Error("start_failed");
      }
      // Hand off to Dodo's hosted checkout.
      window.location.href = data.checkoutUrl;
    } catch {
      setError("We couldn't start the secure payment. Please try again, or contact support if it persists.");
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-12 sm:px-6 sm:py-16">
      <div className="mb-8 max-w-md">
        <Stepper steps={["Account", "Review", "Pay"]} current={loading ? 3 : step} />
      </div>

      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        {/* Left: form */}
        <div className="order-2 lg:order-1">
          {step === 1 && (
            <div className="max-w-md">
              <h1 className="text-xl font-semibold tracking-tight text-sl-text">Your account</h1>
              <p className="mt-1.5 text-sm text-sl-text-muted">
                We credit your purchase to the API account for this email. New here? We create the
                account and issue your API key after payment.
              </p>
              <form
                className="mt-6 flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  setTouched(true);
                  if (emailValid) setStep(2);
                }}
              >
                <Field
                  label="Email"
                  htmlFor="co-email"
                  required
                  error={touched && !emailValid ? "Enter a valid email address." : undefined}
                >
                  <Input
                    id="co-email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    placeholder="you@company.com"
                    value={email}
                    aria-invalid={touched && !emailValid}
                    onChange={(e) => setEmail(e.target.value)}
                    onBlur={() => setTouched(true)}
                  />
                </Field>
                <Button type="submit" size="lg" className="w-fit" disabled={!emailValid}>
                  Continue <ArrowRight className="size-4" />
                </Button>
              </form>
            </div>
          )}

          {step === 2 && (
            <div className="max-w-md">
              <button
                onClick={() => setStep(1)}
                className="mb-4 inline-flex items-center gap-1.5 text-sm text-sl-text-muted hover:text-sl-text"
              >
                <ArrowLeft className="size-4" /> Back
              </button>
              <h1 className="text-xl font-semibold tracking-tight text-sl-text">Review &amp; pay</h1>
              <p className="mt-1.5 text-sm text-sl-text-muted">
                Crediting <span className="font-medium text-sl-text">{email}</span>.
              </p>

              <div className="mt-6 space-y-4">
                <Disclosure title="What you're buying">
                  SaaS analytics — Satelink Trading Intelligence returns derived statistics computed
                  from public market data. It is <strong>not investment advice</strong>, and Satelink
                  never takes custody of your funds or crypto.
                </Disclosure>
                <Disclosure title="How your balance works">
                  Your ${usdValue.toFixed(2)} is added as API credit to a single account balance. That
                  same balance is also spendable via the crypto rail (x402 / USDT), which Dodo does not
                  process. Credits spent are non-refundable; unused credits follow the{" "}
                  <Link href="/refund">Refund &amp; Cancellation Policy</Link>.
                </Disclosure>
              </div>

              <div className="mt-6">
                <Checkbox
                  id="co-consent"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  label={
                    <>
                      I agree to the <Link href="/terms" className="text-sl-accent underline">Terms</Link>{" "}
                      and the{" "}
                      <Link href="/refund" className="text-sl-accent underline">
                        Refund &amp; Cancellation Policy
                      </Link>
                      .
                    </>
                  }
                />
              </div>

              {error && (
                <p className="mt-4 text-sm text-sl-down" role="alert">
                  {error}
                </p>
              )}

              <Button
                size="lg"
                className="mt-6 w-full"
                loading={loading}
                disabled={!configured || !consent || loading}
                onClick={pay}
              >
                {loading ? "Redirecting to secure payment…" : "Continue to secure payment"}
              </Button>
              {!configured && (
                <p className="mt-3 text-sm text-sl-text-muted">
                  Checkout is temporarily unavailable. Please{" "}
                  <Link href="/contact" className="text-sl-accent underline">contact us</Link> to purchase.
                </p>
              )}
              <p className="mt-3 text-center text-xs text-sl-text-subtle">
                Payments are processed by Dodo Payments. You'll complete payment on their secure page.
              </p>
            </div>
          )}
        </div>

        {/* Right: order summary */}
        <aside className="order-1 lg:order-2">
          <div className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-6">
            <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-sl-text-subtle">
              Order summary
            </h2>
            <div className="mt-4 flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-sl-text">Satelink Trading Intelligence</p>
                <p className="text-sm text-sl-text-muted">{label}</p>
              </div>
              <span className="font-sl-mono text-lg font-bold tabular-nums text-sl-text">{price}</span>
            </div>
            <ul className="mt-4 space-y-1.5 text-sm text-sl-text-muted">
              <li>Credited 1:1 as {price} API credit</li>
              <li>No expiry · no subscription · one-time</li>
              <li>Pay by card or UPI</li>
            </ul>
            <div className="mt-5 border-t border-sl-border pt-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-sl-text-muted">Total</span>
                <span className="font-sl-mono text-xl font-bold tabular-nums text-sl-text">{price}</span>
              </div>
              <p className="mt-2 text-xs text-sl-text-subtle">
                Final amount, including any applicable tax, is shown on the Dodo checkout page.
              </p>
            </div>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-sl-text-subtle">
            The crypto rail (x402 pay-per-call and USDT deposits) is separate and never processed by
            Dodo. See <Link href="/pricing" className="text-sl-accent underline">pricing</Link>.
          </p>
        </aside>
      </div>
    </div>
  );
}
