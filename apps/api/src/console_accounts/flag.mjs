// CONSOLE_ACCOUNTS_V1 — server-side console accounts (account ↔ API-key links,
// account settings, per-agent limits, request log, wallet links).
// Default OFF. Read at call time so a Railway env flip takes effect on the
// restart it triggers, with no code change. With the flag off:
//   · /v1/me/* is not mounted,
//   · authorizeAndMeter runs its original single-UPDATE deduction unchanged.
export function isConsoleAccountsEnabled() {
  return process.env.CONSOLE_ACCOUNTS_V1 === 'true';
}
