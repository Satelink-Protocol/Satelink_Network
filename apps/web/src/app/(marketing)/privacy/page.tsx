// /privacy — Privacy Policy (Review). Content in src/lib/legal.ts.
import type { Metadata } from "next";
import { buildMetadata } from "@satelink/seo";
import { LegalView } from "@/components/LegalView";
import { LEGAL } from "@/lib/legal";

const DOC = LEGAL["privacy"];

export const metadata: Metadata = buildMetadata({
  title: DOC.title,
  description: DOC.intro,
  path: "/privacy",
});

export default function Page() {
  return <LegalView doc={DOC} />;
}
