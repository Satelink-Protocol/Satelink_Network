// /solutions/trading — content in src/lib/solutions.ts (SolutionTemplate).
import type { Metadata } from "next";
import { buildMetadata } from "@satelink/seo";
import { SolutionPageView } from "@/components/SolutionPageView";
import { SOLUTIONS } from "@/lib/solutions";

const S = SOLUTIONS["trading"];

export const metadata: Metadata = buildMetadata({
  title: `${S.name} — Satelink solutions`,
  description: S.definition,
  path: `/solutions/trading`,
});

export default function Page() {
  return <SolutionPageView solution={S} />;
}
