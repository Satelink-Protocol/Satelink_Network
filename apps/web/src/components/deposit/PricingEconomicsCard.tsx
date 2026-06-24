/**
 * components/deposit/PricingEconomicsCard.tsx
 * P0 — explains the only confirmed real rate. Static, no network call needed.
 */
'use client';

import React from 'react';
import { CALLS_PER_USDT, METERING_RATE_USDT } from '@/lib/deposit-api';
import { Panel, MetricRow, TOKENS } from './primitives';

export function PricingEconomicsCard() {
  return (
    <Panel title="Pricing">
      <MetricRow label="Rate" value={`$${METERING_RATE_USDT.toFixed(5)} / call`} color={TOKENS.teal} />
      <MetricRow label="1 USDT buys" value={`${CALLS_PER_USDT.toLocaleString()} RPC calls`} />
      <div style={{ color: TOKENS.muted, fontFamily: TOKENS.sans, fontSize: 11, marginTop: 8 }}>
        Pay-as-you-go. No subscription, no minimum monthly spend. Credits never expire.
        Minimum deposit: $0.50 USDT.
      </div>
    </Panel>
  );
}
