// CMS block inventory (§8/§16) — admins compose pages from these. Renderers live
// in @satelink/web-ui (public apps). Blocks with no content are skipped at render.
import type { Block } from "payload";

const richText: Block = { slug: "richText", fields: [{ name: "content", type: "richText" }] };

const heroBlock: Block = {
  slug: "hero",
  fields: [
    { name: "eyebrow", type: "text" },
    { name: "heading", type: "text", required: true },
    { name: "definition", type: "textarea", admin: { description: "Answer-first, ≤50 words." } },
    { name: "ctas", type: "array", fields: [{ name: "label", type: "text" }, { name: "href", type: "text" }] },
  ],
};

const valueCards: Block = {
  slug: "valueCards",
  fields: [
    { name: "cards", type: "array", minRows: 1, fields: [
      { name: "title", type: "text" }, { name: "body", type: "textarea" },
    ] },
  ],
};

const codeBlock: Block = {
  slug: "code",
  fields: [
    { name: "illustrative", type: "checkbox", admin: { description: "Show an Illustrative badge (no live endpoint)." } },
    { name: "tabs", type: "array", fields: [
      { name: "language", type: "select", options: ["curl", "typescript", "python", "go", "json"] },
      { name: "code", type: "code" },
    ] },
  ],
};

const apiExample: Block = {
  slug: "apiExample",
  fields: [
    { name: "endpoint", type: "text" },
    { name: "illustrative", type: "checkbox" },
    { name: "request", type: "code" },
    { name: "response", type: "code" },
  ],
};

const faqBlock: Block = {
  slug: "faq",
  fields: [
    { name: "group", type: "text" },
    { name: "items", type: "array", fields: [{ name: "question", type: "text" }, { name: "answer", type: "textarea" }] },
  ],
};

const ctaBlock: Block = {
  slug: "cta",
  fields: [{ name: "heading", type: "text" }, { name: "label", type: "text" }, { name: "href", type: "text" }],
};

const callout: Block = {
  slug: "callout",
  fields: [
    { name: "tone", type: "select", options: ["info", "warn", "success"] },
    { name: "body", type: "textarea" },
  ],
};

const pricingLive: Block = {
  slug: "pricingLive",
  fields: [{ name: "productSlug", type: "text", admin: { description: "Reads the live catalog; parity-checked in CI." } }],
};

const lifecycleStepper: Block = {
  slug: "lifecycleStepper",
  fields: [{ name: "note", type: "text", admin: { description: "DISCOVER→…→RECEIPT; SSR content from the renderer." } }],
};

const machineReadablePanel: Block = {
  slug: "machineReadablePanel",
  fields: [{ name: "productSlug", type: "text", admin: { description: "Renders the /products/[slug].json data as a visible panel." } }],
};

const comparisonTable: Block = {
  slug: "comparisonTable",
  fields: [{ name: "rows", type: "array", fields: [{ name: "label", type: "text" }, { name: "values", type: "text", hasMany: true }] }],
};

const relatedContent: Block = {
  slug: "relatedContent",
  fields: [{ name: "heading", type: "text", defaultValue: "Related" }],
};

export const layoutBlocks: Block[] = [
  heroBlock, richText, valueCards, codeBlock, apiExample, faqBlock, ctaBlock,
  callout, pricingLive, lifecycleStepper, machineReadablePanel, comparisonTable, relatedContent,
];
