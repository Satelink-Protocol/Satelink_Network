/**
 * Admin command-center route layout (Server Component).
 *
 * - Imports the Satelink-OS theme (global CSS is only allowed in non-client
 *   components; scoped under `.sat-os` so it never bleeds into the landing site).
 * - Binds the geist font CSS variables that `--sat-font-*` reference. The mono
 *   token prefers JetBrains Mono and falls back to Geist Mono, so builds never
 *   depend on a network font fetch.
 */
import type { ReactNode } from 'react';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';

import '@/components/satelink-os/theme/theme.css';

export default function CommandCenterLayout({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  return <div className={`${GeistSans.variable} ${GeistMono.variable} sat-os`}>{children}</div>;
}
