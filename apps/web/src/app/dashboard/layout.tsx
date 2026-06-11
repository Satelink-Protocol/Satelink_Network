export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

import { ReactNode } from 'react';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-slate-950">{children}</div>;
}
