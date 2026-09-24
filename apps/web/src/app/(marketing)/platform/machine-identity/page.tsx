// /platform/machine-identity — see src/lib/platform.ts for the content (PlatformTemplate).
import type { Metadata } from "next";
import { buildMetadata } from "@satelink/seo";
import { PlatformPageView } from "@/components/PlatformPageView";
import { PLATFORM } from "@/lib/platform";

const P = PLATFORM["machine-identity"];

export const metadata: Metadata = buildMetadata({
  title: `${P.name} — Satelink platform`,
  description: P.definition,
  path: P.href,
});

export default function Page() {
  return <PlatformPageView platform={P} />;
}
