/**
 * components/deposit/RevenueVaultProofCard.tsx
 * P0 — the single most important trust signal on this page: the vault is real,
 * on-chain, and verifiable independent of anything Satelink's own UI claims.
 *
 * Backend dependency for live balance: GET /v1/vault/balance. Suggested
 * implementation (see api-stub) is to read it through Satelink's OWN RPC gateway
 * (rpc.satelink.network) via an eth_call to USDT.balanceOf(vault) — which has the
 * side benefit of using the product to prove the product works. If that endpoint
 * isn't deployed yet, the Polygonscan link still works on its own — never block
 * the trust signal on the backend being ready.
 */
'use client';

import React from 'react';
import { getVaultProof, type VaultProof } from '@/lib/deposit-api';
import { Panel, MetricRow, Skeleton, CopyButton, TOKENS } from './primitives';

export function RevenueVaultProofCard() {
  const [proof, setProof] = React.useState<VaultProof | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    getVaultProof().then((p) => {
      if (!cancelled) setProof(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!proof) {
    return (
      <Panel title="RevenueVault">
        <Skeleton height={40} />
      </Panel>
    );
  }

  return (
    <Panel title="RevenueVault">
      <div className="flex items-center justify-between mb-2">
        <span style={{ color: TOKENS.muted, fontFamily: TOKENS.mono, fontSize: 11 }}>
          {proof.address.slice(0, 10)}...{proof.address.slice(-6)}
        </span>
        <CopyButton text={proof.address} />
      </div>

      <MetricRow
        label="Balance"
        value={proof.balanceUsdt !== null ? `$${proof.balanceUsdt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '— (see explorer)'}
        color={TOKENS.teal}
      />
      <MetricRow label="Chain" value="Polygon Mainnet" />

      <a
        href={proof.explorerUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-block mt-3 text-xs underline"
        style={{ color: TOKENS.teal, fontFamily: TOKENS.sans }}
      >
        View contract on Polygonscan →
      </a>
    </Panel>
  );
}
