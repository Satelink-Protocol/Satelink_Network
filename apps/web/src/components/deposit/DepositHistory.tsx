/**
 * components/deposit/DepositHistory.tsx
 * P0 — last item, lowest urgency of the six. Most human users won't need this on
 * day one (they have zero history); it matters more for returning users and for
 * machine customers auditing their own spend.
 *
 * Backend: GET /v1/credits/history/:wallet?page=&limit= (paginated).
 */
'use client';

import React from 'react';
import { getDepositHistory, type DepositHistoryPage } from '@/lib/deposit-api';
import { Panel, Skeleton, ErrorNote, TOKENS } from './primitives';

const PAGE_SIZE = 5;

export function DepositHistory({ wallet }: { wallet: string | null }) {
  const [page, setPage] = React.useState(1);
  const [state, setState] = React.useState<
    { status: 'idle' } | { status: 'loading' } | { status: 'error'; message: string } | { status: 'ok'; data: DepositHistoryPage }
  >({ status: 'idle' });

  // Reset to the first page whenever the wallet changes.
  React.useEffect(() => {
    setPage(1);
  }, [wallet]);

  // Fetch on mount/page change, then poll every 30s so a fresh deposit shows
  // up without a manual reload (crediting is ~25 confirmations + listener poll,
  // so the user is typically staring at "No deposits yet" while it lands).
  React.useEffect(() => {
    if (!wallet) {
      setState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    let first = true;
    const load = () => {
      if (first) setState({ status: 'loading' });
      getDepositHistory(wallet, page, PAGE_SIZE).then(({ data, error }) => {
        if (cancelled) return;
        if (data) setState({ status: 'ok', data });
        // Only surface an error on the initial load — a failed background
        // refresh keeps showing the last good data instead of flashing red.
        else if (first) setState({ status: 'error', message: error ?? 'unknown error' });
        first = false;
      });
    };
    load();
    const timer = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [wallet, page]);

  if (!wallet) return null;

  const data = state.status === 'ok' ? state.data : null;
  const canPrev = page > 1;
  const canNext = !!data?.hasMore;

  return (
    <Panel
      title="Deposit History"
      right={
        // Subtle "live" pulse — the list background-refreshes every 30s.
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          <span className="size-1.5 rounded-full bg-state-healthy animate-pulse-glow" aria-hidden />
          live · 30s
        </span>
      }
    >
      {state.status === 'loading' && (
        <div className="space-y-2">
          <Skeleton height={16} />
          <Skeleton height={16} />
        </div>
      )}
      {state.status === 'error' && <ErrorNote>Couldn&apos;t load history ({state.message}).</ErrorNote>}
      {data && data.deposits.length === 0 && (
        <div style={{ color: TOKENS.muted, fontFamily: TOKENS.sans, fontSize: 13 }}>
          No deposits yet for this wallet. This list refreshes automatically every
          30 seconds — a new deposit appears once it reaches 25 confirmations.
        </div>
      )}
      {data && data.deposits.length > 0 && (
        <>
          <table className="w-full text-xs" style={{ fontFamily: TOKENS.mono }}>
            <thead>
              <tr style={{ color: TOKENS.muted }}>
                <th className="text-left pb-2">Date</th>
                <th className="text-right pb-2">Amount</th>
                <th className="text-right pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.deposits.map((d) => (
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

          {/* prev / next pagination control */}
          <div className="flex items-center justify-between mt-3">
            <button
              onClick={() => canPrev && setPage((p) => p - 1)}
              disabled={!canPrev}
              className="text-[11px] px-2 py-1 rounded border transition-colors"
              style={{
                borderColor: TOKENS.border,
                color: canPrev ? TOKENS.teal : TOKENS.muted,
                opacity: canPrev ? 1 : 0.4,
                fontFamily: TOKENS.mono,
                cursor: canPrev ? 'pointer' : 'default',
              }}
            >
              ← Prev
            </button>
            <span style={{ color: TOKENS.muted, fontFamily: TOKENS.mono, fontSize: 10 }}>
              Page {data.page} · {data.total} total
            </span>
            <button
              onClick={() => canNext && setPage((p) => p + 1)}
              disabled={!canNext}
              className="text-[11px] px-2 py-1 rounded border transition-colors"
              style={{
                borderColor: TOKENS.border,
                color: canNext ? TOKENS.teal : TOKENS.muted,
                opacity: canNext ? 1 : 0.4,
                fontFamily: TOKENS.mono,
                cursor: canNext ? 'pointer' : 'default',
              }}
            >
              Next →
            </button>
          </div>
        </>
      )}
    </Panel>
  );
}
