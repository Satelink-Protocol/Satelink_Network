/**
 * components/deposit/DepositHistory.tsx
 * P0 — last item, lowest urgency of the six. Most human users won't need this on
 * day one (they have zero history); it matters more for returning users and for
 * machine customers auditing their own spend.
 *
 * Backend dependency: GET /v1/credits/history/:wallet — not confirmed live.
 */
'use client';

import React from 'react';
import { getDepositHistory, type DepositRecord } from '@/lib/deposit-api';
import { Panel, Skeleton, ErrorNote, TOKENS } from './primitives';

export function DepositHistory({ wallet }: { wallet: string | null }) {
  const [state, setState] = React.useState<
    { status: 'idle' } | { status: 'loading' } | { status: 'error'; message: string } | { status: 'ok'; data: DepositRecord[] }
  >({ status: 'idle' });

  React.useEffect(() => {
    if (!wallet) {
      setState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    getDepositHistory(wallet).then(({ data, error }) => {
      if (cancelled) return;
      if (data) setState({ status: 'ok', data });
      else setState({ status: 'error', message: error ?? 'unknown error' });
    });
    return () => {
      cancelled = true;
    };
  }, [wallet]);

  if (!wallet) return null;

  return (
    <Panel title="Deposit History">
      {state.status === 'loading' && (
        <div className="space-y-2">
          <Skeleton height={16} />
          <Skeleton height={16} />
        </div>
      )}
      {state.status === 'error' && <ErrorNote>Couldn't load history ({state.message}).</ErrorNote>}
      {state.status === 'ok' && state.data.length === 0 && (
        <div style={{ color: TOKENS.muted, fontFamily: TOKENS.sans, fontSize: 13 }}>
          No deposits yet for this wallet.
        </div>
      )}
      {state.status === 'ok' && state.data.length > 0 && (
        <table className="w-full text-xs" style={{ fontFamily: TOKENS.mono }}>
          <thead>
            <tr style={{ color: TOKENS.muted }}>
              <th className="text-left pb-2">Date</th>
              <th className="text-right pb-2">Amount</th>
              <th className="text-right pb-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {state.data.map((d) => (
              <tr key={d.txHash} style={{ borderTop: `1px solid ${TOKENS.border}` }}>
                <td className="py-2" style={{ color: TOKENS.text }}>
                  {new Date(d.createdAt).toLocaleDateString()}
                </td>
                <td className="py-2 text-right" style={{ color: TOKENS.teal }}>
                  ${d.amountUsdt.toFixed(2)}
                </td>
                <td
                  className="py-2 text-right"
                  style={{ color: d.status === 'CONFIRMED' ? TOKENS.green : d.status === 'FAILED' ? TOKENS.red : TOKENS.amber }}
                >
                  {d.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
