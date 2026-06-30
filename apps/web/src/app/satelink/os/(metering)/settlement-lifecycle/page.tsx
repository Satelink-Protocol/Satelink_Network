import { redirect } from "next/navigation";

// SECURITY: This page exposed platform-wide settlement/treasury state, signer
// wallet details, and pipeline controls on the customer subdomain, which has no
// auth. Fail closed — redirect on the server before any data fetch or render,
// so direct URL access also fails.
export default function SettlementLifecyclePage() {
  redirect("/satelink/os/mission-control");
}
