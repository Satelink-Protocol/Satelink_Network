/**
 * Client-side wagmi + react-query providers for the deposit page wallet-connect.
 * Scoped to the deposit page (wraps it in page.tsx) rather than the whole app, so
 * the rest of the site is unaffected.
 */
'use client';

import React from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wagmiConfig } from './config';

const queryClient = new QueryClient();

export function WalletProvider({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
