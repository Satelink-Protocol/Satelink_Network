import { redirect } from "next/navigation";

// SECURITY: This page exposed platform-wide treasury data, an epoch-rollup
// trigger, and a cross-customer table (every customer's IP / calls / spend) on
// the customer subdomain, which has no auth. Fail closed — redirect on the
// server before any data fetch or render, so direct URL access also fails.
export default function RevenueOpsPage() {
  redirect("/satelink/os/mission-control");
}
