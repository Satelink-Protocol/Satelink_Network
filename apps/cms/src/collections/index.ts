// Collection registry (§13) — the 25 collections wired into payload.config.
import type { CollectionConfig } from "payload";
import { contentCollection } from "./factory";
import { requireVerifiedToPublish, stampPublishedAt, bannedPhraseGuard } from "../hooks/truth";
import { auditAfterChange } from "../hooks/audit-log";
import { revalidateOnPublish } from "../hooks/revalidate";
import { hasRole, authenticated } from "../access/roles";
import { statusField, siteField } from "../fields/common";
import { Users, Media, AuditLog, Enquiries, PricingDisplay, Redirects } from "./system";
import { People, JobOpenings, Authors, Categories, Tags } from "./people-and-taxonomy";
import { SupportCategories, SupportArticles, FAQs, Feedback, Announcements } from "./support";

// --- Factory-built content collections ---
const Pages = contentCollection({ slug: "pages", labelSingular: "Page", labelPlural: "Pages", group: "Content", withRelationships: true });

const Products = contentCollection({
  slug: "products", labelSingular: "Product", labelPlural: "Products", group: "Content", withRelationships: true,
  extraFields: [
    { name: "canonicalConcept", type: "text", admin: { description: "e.g. machineCommerce (see @satelink/content CANONICAL_URL)." } },
    { name: "definition", type: "textarea", admin: { description: "≤50-word answer-first definition." } },
    { name: "isDodoSurface", type: "checkbox", admin: { description: "Only trading-intelligence should enable this." } },
    { name: "paymentRails", type: "select", hasMany: true, options: ["dodo_card_upi", "x402_usdc_base", "usdt_polygon", "credit_pack"] },
    { name: "capabilities", type: "array", fields: [{ name: "title", type: "text" }, { name: "body", type: "textarea" }] },
  ],
});

const Solutions = contentCollection({
  slug: "solutions", labelSingular: "Solution", labelPlural: "Solutions", group: "Content", withRelationships: true,
  extraFields: [
    { name: "audienceType", type: "select", options: ["company", "use-case", "industry"] },
    { name: "problem", type: "textarea" },
    { name: "whyNow", type: "textarea" },
  ],
});

const Articles = contentCollection({
  slug: "articles", labelSingular: "Article", labelPlural: "Articles", group: "Resources", withRelationships: true,
  extraFields: [
    { name: "subtitle", type: "text" },
    { name: "articleType", type: "select", defaultValue: "Article", options: ["Article", "NewsArticle", "TechArticle"] },
  ],
});

const NewsArticles = contentCollection({
  slug: "news", labelSingular: "News article", labelPlural: "News", group: "Resources",
  extraFields: [{ name: "source", type: "select", options: ["satelink", "jakuraa"], defaultValue: "satelink" }, { name: "externalUrl", type: "text" }],
});

const ChangelogEntries = contentCollection({
  slug: "changelog", labelSingular: "Changelog entry", labelPlural: "Changelog", group: "Resources",
  extraFields: [{ name: "version", type: "text" }, { name: "area", type: "text" }],
});

const Courses = contentCollection({ slug: "courses", labelSingular: "Course", labelPlural: "Courses", group: "Academy",
  extraFields: [{ name: "level", type: "select", options: ["intro", "intermediate", "advanced"] }, { name: "lessons", type: "relationship", relationTo: "lessons", hasMany: true }] });

const Lessons = contentCollection({ slug: "lessons", labelSingular: "Lesson", labelPlural: "Lessons", group: "Academy",
  extraFields: [{ name: "course", type: "relationship", relationTo: "courses" }, { name: "order", type: "number" }] });

const Tutorials = contentCollection({
  slug: "tutorials", labelSingular: "Tutorial", labelPlural: "Tutorials", group: "Academy", withRelationships: true,
  extraFields: [
    { name: "prereqs", type: "array", fields: [{ name: "item", type: "text" }] },
    { name: "endpointVerified", type: "checkbox", admin: { description: "Publish only when backed by a live endpoint; else keep Draft 'Available soon'." } },
    { name: "nextTutorial", type: "relationship", relationTo: "tutorials" },
  ],
});

const UseCases = contentCollection({ slug: "use-cases", labelSingular: "Use case", labelPlural: "Use cases", group: "Academy", withRelationships: true,
  extraFields: [{ name: "scenario", type: "textarea" }, { name: "productsUsed", type: "relationship", relationTo: "products", hasMany: true }] });

// CustomerStory — explicit because it requires verifiedBy+verifiedAt to publish.
const CustomerStories: CollectionConfig = {
  slug: "customer-stories",
  labels: { singular: "Customer story", plural: "Customer stories" },
  admin: { group: "Resources", useAsTitle: "title", defaultColumns: ["title", "status", "verifiedAt"] },
  versions: { drafts: { autosave: true, schedulePublish: true } },
  access: { read: () => true, create: authenticated, update: hasRole("content-admin"), delete: hasRole("content-admin") },
  hooks: { beforeChange: [bannedPhraseGuard, requireVerifiedToPublish, stampPublishedAt], afterChange: [auditAfterChange, revalidateOnPublish] },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "slug", type: "text", required: true, index: true },
    { name: "logo", type: "upload", relationTo: "media" },
    { name: "quote", type: "textarea" },
    { name: "body", type: "richText" },
    siteField,
    statusField,
    { name: "verifiedBy", type: "relationship", relationTo: "users" },
    { name: "verifiedAt", type: "date" },
    { name: "publishedAt", type: "date", admin: { position: "sidebar" } },
  ],
};

export const collections: CollectionConfig[] = [
  // Content
  Pages, Products, Solutions, Articles, NewsArticles, ChangelogEntries, CustomerStories,
  Announcements, PricingDisplay,
  // Academy
  Courses, Lessons, Tutorials, UseCases,
  // Support
  SupportCategories, SupportArticles, FAQs, Feedback,
  // Company
  People, JobOpenings,
  // Taxonomy
  Authors, Categories, Tags, Media,
  // System
  Users, AuditLog, Enquiries, Redirects,
];
