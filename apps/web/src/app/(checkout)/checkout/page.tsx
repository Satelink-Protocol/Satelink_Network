// /checkout?plan=starter — pre-checkout: plan summary, disclosures, consent,
// then hand off to the EXISTING Dodo integration (/api/dodo-checkout). No new
// Dodo product, no webhook change. Unknown plan → 308 to /pricing.
import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { findPackByPlan } from "@/lib/dodo/credit-packs";
import { CheckoutForm } from "./CheckoutForm";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
};

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const { plan = "starter" } = await searchParams;
  const known = plan === "starter" || plan === "";
  if (!known) permanentRedirect("/pricing");

  // Pack may be undefined when NEXT_PUBLIC_DODO_CREDIT_PACKS is unset (local /
  // unconfigured preview). CheckoutForm renders an "unavailable" state then.
  const pack = findPackByPlan(plan);

  return (
    <CheckoutForm
      productId={pack?.productId ?? null}
      usdValue={pack?.usdValue ?? 9.99}
      label={pack?.label ?? "Starter Pack"}
      configured={Boolean(pack)}
    />
  );
}
