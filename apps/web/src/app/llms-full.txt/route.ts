// GET /llms-full.txt — llms.txt plus each product's canonical body as Markdown
// (§12), via @satelink/seo generateLlmsFullTxt. Bodies come from the same
// single-sourced product facts as the pages, so they never drift.
import { generateLlmsFullTxt } from "@satelink/seo";
import { SITES } from "@satelink/content";
import { getCatalog } from "@/lib/intelligence";
import { buildLlmsInput } from "@/lib/machine";
import { PRODUCTS, PRODUCT_ORDER } from "@/lib/products";

export const revalidate = 300;

export async function GET() {
  const { catalog } = await getCatalog();
  const pages = PRODUCT_ORDER.map((slug) => {
    const p = PRODUCTS[slug];
    const md = [
      `${p.definition}`,
      "",
      "## Capabilities",
      ...p.capabilities.map((c) => `- ${c}`),
      "",
      "## Example request",
      "```",
      p.exampleRequest,
      "```",
    ].join("\n");
    return { title: p.name, url: `${SITES.satelink.origin}${p.href}`, markdown: md };
  });
  const body = generateLlmsFullTxt(buildLlmsInput(catalog), pages);
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300, s-maxage=300" },
  });
}
