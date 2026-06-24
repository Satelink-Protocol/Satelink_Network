/**
 * components/deposit/CreditEstimator.tsx
 * P0 — "buy network capacity" framing, not "send money".
 *
 * Deliberately scoped to RPC calls only. The reference spec wanted AI-request and
 * automation-job conversions too, but there is no confirmed per-unit price for either
 * in production billing data — only the $0.00003/RPC-call rate is verified. Showing
 * invented ratios on a payment page is a trust problem, not a feature. Extend the
 * `rows` array below the day you have a real number for AI Gateway billing.
 */
'use client';

import React from 'react';
import { CALLS_PER_USDT, estimateCapacity } from '@/lib/deposit-api';
import { Panel, TOKENS } from './primitives';

export function CreditEstimator({
  amount,
  onAmountChange,
}: {
  amount: number;
  onAmountChange: (n: number) => void;
}) {
  const { rpcCalls } = estimateCapacity(amount);

  return (
    <Panel title="Estimate Your Capacity">
      <div className="flex items-center gap-3 mb-4">
        <span style={{ color: TOKENS.muted, fontFamily: TOKENS.mono, fontSize: 13 }}>USDT</span>
        <input
          type="number"
          min={0}
          step="0.5"
          value={Number.isFinite(amount) ? amount : ''}
          onChange={(e) => onAmountChange(parseFloat(e.target.value))}
          placeholder="10"
          className="flex-1 bg-transparent border rounded px-3 py-2 outline-none"
          style={{
            borderColor: TOKENS.border,
            color: TOKENS.text,
            fontFamily: TOKENS.mono,
            fontSize: 18,
          }}
        />
      </div>

      <div
        className="rounded border px-4 py-3"
        style={{ borderColor: TOKENS.border, background: `${TOKENS.teal}0D` }}
      >
        <div style={{ color: TOKENS.muted, fontSize: 11, fontFamily: TOKENS.sans }}>
          You receive
        </div>
        <div
          style={{ color: TOKENS.teal, fontFamily: TOKENS.mono, fontSize: 24, fontWeight: 700 }}
        >
          {rpcCalls.toLocaleString()} RPC calls
        </div>
        <div style={{ color: TOKENS.muted, fontSize: 10, fontFamily: TOKENS.sans, marginTop: 4 }}>
          at the current metered rate (1 USDT ≈ {CALLS_PER_USDT.toLocaleString()} calls). Runtime
          depends on your call volume — this is capacity, not a time estimate.
        </div>
      </div>
    </Panel>
  );
}
