// /network/operator-terms — Node Operator Terms (Review). Content in
// src/lib/legal.ts. Node-operator obligations were moved here out of /terms.
import type { Metadata } from "next";
import { buildMetadata } from "@satelink/seo";
import { LegalView } from "@/components/LegalView";
import { LEGAL } from "@/lib/legal";

const DOC = LEGAL["operator-terms"];

export const metadata: Metadata = buildMetadata({
  title: DOC.title,
  description: DOC.intro,
  path: "/network/operator-terms",
});

export default function Page() {
  return <LegalView doc={DOC} />;
}
