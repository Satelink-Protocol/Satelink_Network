/**
 * components/deposit/FundingWorkflow.tsx
 * P0 — static, above-the-fold explainer of the funding lifecycle. Five steps,
 * horizontal. No backend, no animation — pure orientation for first-time users.
 */
'use client';

import React from 'react';
import { Panel, TOKENS } from './primitives';

const STEPS = [
  { n: 1, label: 'Deposit USDT', sub: 'to RevenueVault on Polygon' },
  { n: 2, label: 'Credits Issued', sub: 'auto-credited on confirmation' },
  { n: 3, label: 'API Usage', sub: 'call the RPC gateway' },
  { n: 4, label: 'Metered Billing', sub: '$0.00003 per call' },
  { n: 5, label: 'Settlement', sub: 'on-chain USDT per epoch' },
];

export function FundingWorkflow() {
  return (
    <Panel title="How Funding Works">
      <div className="flex items-stretch" style={{ gap: 0, overflowX: 'auto' }}>
        {STEPS.map((step, i) => (
          <React.Fragment key={step.n}>
            <div className="flex-1 min-w-[120px] flex flex-col items-center text-center px-2">
              <div
                className="flex items-center justify-center rounded-full mb-2"
                style={{
                  width: 28,
                  height: 28,
                  background: `${TOKENS.teal}1A`,
                  color: TOKENS.teal,
                  fontFamily: TOKENS.mono,
                  fontSize: 13,
                  fontWeight: 700,
                  border: `1px solid ${TOKENS.teal}55`,
                }}
              >
                {step.n}
              </div>
              <div
                style={{ color: TOKENS.text, fontFamily: TOKENS.sans, fontSize: 12, fontWeight: 600 }}
              >
                {step.label}
              </div>
              <div style={{ color: TOKENS.muted, fontFamily: TOKENS.sans, fontSize: 10, marginTop: 2 }}>
                {step.sub}
              </div>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className="flex items-center"
                style={{ color: TOKENS.muted, fontFamily: TOKENS.mono, fontSize: 16, paddingBottom: 22 }}
                aria-hidden
              >
                →
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
    </Panel>
  );
}
