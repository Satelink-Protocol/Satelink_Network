"use client";

/**
 * Wallet → API-key registration map, kept in localStorage alongside the
 * existing key store (lib/api-keys.ts).
 *
 * Why: an API key from POST /v1/machine/register is bound to the wallet that
 * signed the registration message, and on-chain deposits auto-credit by SENDER
 * wallet. If MetaMask has a different wallet connected on the deposit page,
 * the deposit funds a different (possibly nonexistent) account. This map lets
 * the deposit page detect that mismatch and warn before the user sends funds.
 */

const MAP_KEY = "satelink_wallet_registrations";

export interface WalletRegistration {
  apiKey: string;
  registeredAt: string; // ISO timestamp
}

/** The exact EIP-191 message the backend verifies (machine_onboarding.js). */
export function registrationMessage(wallet: string): string {
  return `satelink:register:${wallet.toLowerCase()}`;
}

export function loadWalletRegistrations(): Record<string, WalletRegistration> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(MAP_KEY);
    return raw ? (JSON.parse(raw) as Record<string, WalletRegistration>) : {};
  } catch {
    return {};
  }
}

export function saveWalletRegistration(wallet: string, apiKey: string): void {
  const map = loadWalletRegistrations();
  map[wallet.toLowerCase()] = { apiKey, registeredAt: new Date().toISOString() };
  localStorage.setItem(MAP_KEY, JSON.stringify(map));
}

/** Registration entry for a wallet, or null if this browser never registered it. */
export function registrationFor(
  wallet: string | null | undefined
): WalletRegistration | null {
  if (!wallet) return null;
  return loadWalletRegistrations()[wallet.toLowerCase()] ?? null;
}

/** All wallets registered from this browser (lowercase). */
export function registeredWallets(): string[] {
  return Object.keys(loadWalletRegistrations());
}
