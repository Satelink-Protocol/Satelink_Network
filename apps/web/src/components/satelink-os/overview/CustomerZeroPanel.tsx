import React from 'react';
import { CustomerZeroCard, type CustomerZeroLead } from '../../shadcn-trial/CustomerZeroCard';

export interface CustomerZeroPanelProps {
  leads: CustomerZeroLead[] | null;
  czHit: boolean;
}

export function CustomerZeroPanel({ leads, czHit }: CustomerZeroPanelProps): JSX.Element {
  return <CustomerZeroCard leads={leads} czHit={czHit} />;
}
