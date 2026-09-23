// Console layout (web-v3 P6) — the customer console is DARK by default (§7.2)
// and noindex. Sets data-theme="dark" on a wrapper so the --sl-* tokens
// re-scope to the dark palette for the whole subtree, independent of the
// light-first marketing default.
import type { Metadata } from "next";
import { ConsoleShell } from "./ConsoleShell";

export const metadata: Metadata = {
  title: { default: "Console", template: "%s · Satelink Console" },
  robots: { index: false, follow: false },
};

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-theme="dark">
      <ConsoleShell>{children}</ConsoleShell>
    </div>
  );
}
