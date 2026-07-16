// Shared helpers for the admin dashboard.

// Mirror of apps/api/src/payments/founder_wallets.js. Founder-funded wallets
// must never be counted as external paying customers. /admin/customers/list is
// NOT founder-aware (unlike /admin/revenue/summary), so the UI filters here.
// Keep this list in sync with the backend. Addresses MUST be lowercase.
export const FOUNDER_WALLETS = new Set([
  "0x5cbda3a1c0f1b28fecea1d919785321e88f9fa97",
  "0x966e1ae22996545015b1414b35234b10719d7ad4", // treasury / deployer
  "0x175727a8486a7eb3ac4bcf2a1a89fd2d58ca0dfd", // mainnet validation machine
  "0x55691946766f4666c786ea8ee2bea176ecc3a841", // sepolia validation ephemeral
]);

export function isFounderWallet(addr?: string | null): boolean {
  return !!addr && FOUNDER_WALLETS.has(addr.toLowerCase());
}

// automation_logs.result comes back as a parsed JSON value (object), not a
// string — rendering it raw throws "Objects are not valid as a React child".
export function fmtResult(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
