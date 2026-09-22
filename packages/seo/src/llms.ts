// llms.txt / llms-full.txt generators (§12). Generated from the live catalog +
// docs index at build time — never hand-typed. Replace the existing static
// /llms.txt after diffing (keep anything still true).
import { CANONICAL_URL, DISCOVERY, SITES } from "@satelink/content";
import type { PriceLine } from "@satelink/content";

export type LlmsInput = {
  products: { slug: string; label: string; summary: string; prices: PriceLine[] }[];
  docs: { title: string; url: string }[];
};

function priceList(prices: PriceLine[]): string {
  if (!prices.length) return "  (pricing: see /pricing)";
  return prices
    .map((p) => `  - ${p.metric}: $${p.price} / ${p.unit} (${p.currency})`)
    .join("\n");
}

export function generateLlmsTxt(input: LlmsInput): string {
  const lines: string[] = [];
  lines.push("# Satelink — Machine Commerce Infrastructure");
  lines.push("");
  lines.push(
    "Infrastructure for software agents, machines, developers, and businesses to discover, access, pay for, and settle machine-native services."
  );
  lines.push("");
  lines.push("## Canonical concepts");
  for (const [k, path] of Object.entries(CANONICAL_URL)) {
    lines.push(`- ${k}: ${SITES.satelink.origin}${path}`);
  }
  lines.push("");
  lines.push("## Products");
  for (const p of input.products) {
    lines.push(`### ${p.label} (${SITES.satelink.origin}/products/${p.slug})`);
    lines.push(p.summary);
    lines.push(priceList(p.prices));
    lines.push("");
  }
  lines.push("## Discovery & payment");
  lines.push(`- Discovery: ${DISCOVERY.wellKnown}`);
  lines.push(`- Catalog: ${DISCOVERY.catalog}`);
  lines.push("- Auth: API key or x402 (HTTP 402 returns machine-readable payment requirements).");
  lines.push("- After 402: pay per the returned requirements, or buy credits, then retry.");
  lines.push("");
  lines.push("## Docs");
  for (const d of input.docs) lines.push(`- ${d.title}: ${d.url}`);
  lines.push("");
  return lines.join("\n");
}

/** llms-full.txt concatenates canonical page bodies as Markdown. */
export function generateLlmsFullTxt(
  input: LlmsInput,
  pages: { title: string; url: string; markdown: string }[]
): string {
  const head = generateLlmsTxt(input);
  const body = pages
    .map((p) => `\n\n---\n\n# ${p.title}\n<${p.url}>\n\n${p.markdown.trim()}`)
    .join("");
  return `${head}${body}\n`;
}
