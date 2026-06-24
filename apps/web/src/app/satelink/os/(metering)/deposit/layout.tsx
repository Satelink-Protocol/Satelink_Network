/**
 * Deposit route layout (Server Component).
 *
 * Brings the Satelink-OS design system into the deposit page:
 * - Imports the Satelink-OS theme (global CSS, scoped under `.sat-os` so it
 *   never bleeds into the landing site).
 * - Binds the geist font CSS variables that `--sat-font-*` reference. The mono
 *   token prefers JetBrains Mono and falls back to Geist Mono, so builds never
 *   depend on a network font fetch.
 *
 * Mirrors app/admin/command-center/layout.tsx so the deposit page shares the
 * exact same visual system as the rest of the product.
 */
import type { ReactNode } from 'react';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';

import '@/components/satelink-os/theme/theme.css';

export default function DepositLayout({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  return <div className={`${GeistSans.variable} ${GeistMono.variable} sat-os`}>{children}</div>;
}
