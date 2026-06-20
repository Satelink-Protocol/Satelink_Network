/**
 * components/deposit/WalletBalanceCard.tsx
 * P0 — shows current credits for a connected wallet.
 *
 * Backend dependency: GET /v1/credits/balance/:wallet — NOT confirmed live as of
 * the June 19 session summary. Until it's deployed (see api-stub/deposit_economics.js),
 * this renders an honest "not connected to a live source yet" state instead of a
 * fabricated number. Do not stub this with mock data in production — that's exactly
 * the kind of "metered vs collected" confusion the project has been burned by before.
 */
'use client';

import React from 'react';
import { getCreditBalance, type CreditBalance } from '@/lib/deposit-api';
import { Panel, MetricRow, Skeleton, ErrorNote, TOKENS } from './primitives';

export function WalletBalanceCard({ wallet }: { wallet: string | null }) {
  const [state, setState] = React.useState<
    { status: 'idle' } | { status: 'loading' } | { status: 'error'; message: string } | { status: 'ok'; data: CreditBalance }
  >({ status: 'idle' });

  React.useEffect(() => {
    if (!wallet) {
      setState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    getCreditBalance(wallet).then(({ data, error }) => {
      if (cancelled) return;
      if (data) setState({ status: 'ok', data });
      else setState({ status: 'error', message: error ?? 'unknown error' });
    });
    return () => {
      cancelled = true;
    };
  }, [wallet]);

  return (
    <Panel title="Connected Wallet">
      {!wallet && (
        <div style={{ color: TOKENS.muted, fontFamily: TOKENS.sans, fontSize: 13 }}>
          No wallet connected. Connect a wallet to see your live credit balance.
        </div>
      )}

      {wallet && state.status === 'loading' && (
        <div className="space-y-2">
          <Skeleton height={14} />
          <Skeleton height={14} width="60%" />
        </div>
      )}

      {wallet && state.status === 'error' && (
        <ErrorNote>
          Couldn't load balance for this wallet ({state.message}). The deposit/approve
          flow below still works independently — balance lookup is read-only.
        </ErrorNote>
      )}

      {wallet && state.status === 'ok' && (
        <div>
          <div style={{ color: TOKENS.muted, fontFamily: TOKENS.mono, fontSize: 11 }}>
            {wallet.slice(0, 6)}...{wallet.slice(-4)}
          </div>
          <MetricRow
            label="Current Credits"
            value={`$${state.data.creditsUsdt.toFixed(4)}`}
            color={TOKENS.teal}
          />
          <MetricRow
            label="Consumed"
            value={`$${state.data.consumedUsdt.toFixed(6)}`}
          />
          <MetricRow
            label="Est. Remaining Calls"
            value={state.data.estimatedRemainingCalls.toLocaleString()}
            hint="at $0.00003 / RPC call"
          />
          <MetricRow
            label="Pending Deposits"
            value={String(state.data.pendingDeposits)}
          />
          <MetricRow
            label="Last Deposit"
            value={state.data.lastDepositAt ? new Date(state.data.lastDepositAt).toLocaleDateString() : 'Never'}
          />
        </div>
      )}
    </Panel>
  );
}
