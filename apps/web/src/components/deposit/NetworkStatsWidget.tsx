/**
 * components/deposit/NetworkStatsWidget.tsx
 * P0 — proof the network is real and active.
 *
 * Fields shown here are exactly the ones already confirmed live on
 * /satelink/os/overview (per the June 19 session summary): metered unbilled USDT,
 * epoch count, requests/24h, active IPs, last epoch status. Nothing invented
 * (no "99.98% network health" — that number doesn't exist anywhere in your data).
 *
 * IMPORTANT: point getNetworkStats() in lib/deposit-api.ts at the real endpoint
 * that already backs the os/overview page before shipping this.
 */
'use client';

import React from 'react';
import { getNetworkStats, type NetworkStats } from '@/lib/deposit-api';
import { Panel, MetricRow, Skeleton, ErrorNote, Badge, TOKENS } from './primitives';

export function NetworkStatsWidget() {
  const [state, setState] = React.useState<
    { status: 'loading' } | { status: 'error'; message: string } | { status: 'ok'; data: NetworkStats }
  >({ status: 'loading' });

  React.useEffect(() => {
    let cancelled = false;
    getNetworkStats().then(({ data, error }) => {
      if (cancelled) return;
      if (data) setState({ status: 'ok', data });
      else setState({ status: 'error', message: error ?? 'unknown error' });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Panel
      title="Network Status"
      right={state.status === 'ok' ? <Badge label="LIVE" color={TOKENS.green} /> : undefined}
    >
      {state.status === 'loading' && (
        <div className="space-y-2">
          <Skeleton height={14} />
          <Skeleton height={14} />
          <Skeleton height={14} width="70%" />
        </div>
      )}

      {state.status === 'error' && (
        <ErrorNote>
          Live network stats unavailable right now ({state.message}). The deposit flow
          is unaffected — this panel is informational only.
        </ErrorNote>
      )}

      {state.status === 'ok' && (
        <div>
          <MetricRow
            label="Metered (Unbilled)"
            value={`$${state.data.meteredUnbilledUsdt.toFixed(6)}`}
            hint="accrued, not yet settled on-chain"
          />
          <MetricRow label="Settlement Epochs" value={state.data.epochCount.toLocaleString()} />
          <MetricRow label="Requests (24h)" value={state.data.requests24h.toLocaleString()} />
          <MetricRow label="Active IPs" value={state.data.activeIps.toLocaleString()} />
          <MetricRow
            label="Last Epoch"
            value={state.data.lastEpochStatus}
            color={state.data.lastEpochStatus === 'SETTLED' ? TOKENS.green : TOKENS.amber}
          />
          <div style={{ color: TOKENS.muted, fontFamily: TOKENS.mono, fontSize: 9, marginTop: 8 }}>
            as of {new Date(state.data.asOf).toLocaleString()}
          </div>
        </div>
      )}
    </Panel>
  );
}
