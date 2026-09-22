// GET /llms.txt — generated from the product facts + live catalog (§12), via
// @satelink/seo generateLlmsTxt. Replaces the former static public/llms.txt
// (which was RPC-only) with the machine-commerce IA positioning.
import { generateLlmsTxt } from "@satelink/seo";
import { getCatalog } from "@/lib/intelligence";
import { buildLlmsInput } from "@/lib/machine";

export const revalidate = 300;

export async function GET() {
  const { catalog } = await getCatalog();
  const body = generateLlmsTxt(buildLlmsInput(catalog));
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300, s-maxage=300" },
  });
}
