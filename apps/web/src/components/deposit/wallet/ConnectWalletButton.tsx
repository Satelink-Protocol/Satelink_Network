/**
 * Minimal connect button for the deposit page header. Uses the injected connector
 * (MetaMask / browser wallet). Connected address flows into the page's `wallet`
 * state via wagmi's useAccount() in page.tsx — this component only drives connect
 * / disconnect.
 */
'use client';

import React from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { Button } from '@/components/satelink-os';

export function ConnectWalletButton() {
  const { address, isConnected } = useAccount();
  const { connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <Button tone="muted" size="sm" onClick={() => disconnect()}>
        {address.slice(0, 6)}…{address.slice(-4)} · Disconnect
      </Button>
    );
  }

  return (
    <Button
      tone="primary"
      size="sm"
      onClick={() => connect({ connector: injected() })}
      disabled={isPending}
    >
      {isPending ? 'Connecting…' : 'Connect Wallet'}
    </Button>
  );
}
