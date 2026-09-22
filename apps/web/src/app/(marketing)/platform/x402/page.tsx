// /platform/x402 — see src/lib/platform.ts for the content (PlatformTemplate).
import type { Metadata } from "next";
import { buildMetadata } from "@satelink/seo";
import { PlatformPageView } from "@/components/PlatformPageView";
import { PLATFORM } from "@/lib/platform";

const P = PLATFORM["x402"];

export const metadata: Metadata = buildMetadata({
  title: `${P.name} — Satelink platform`,
  description: P.definition,
  path: P.href,
});

export default function Page() {
  return <PlatformPageView platform={P} />;
}
