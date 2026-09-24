// Globals (§13): Navigation, Footer, SiteSettings, SEODefaults, RobotsConfig.
import type { GlobalConfig } from "payload";
import { hasRole } from "../access/roles";

const navItem = [
  { name: "label", type: "text" as const, required: true },
  { name: "href", type: "text" as const, required: true },
  { name: "description", type: "text" as const },
  { name: "badge", type: "text" as const },
];

export const Navigation: GlobalConfig = {
  slug: "navigation",
  admin: { group: "Site" },
  access: { read: () => true, update: hasRole("content-admin", "technical-admin") },
  fields: [
    { name: "site", type: "select", options: ["satelink", "jakuraa"], defaultValue: "satelink" },
    {
      name: "menus", type: "array", fields: [
        { name: "label", type: "text", required: true },
        { name: "groups", type: "array", fields: [
          { name: "title", type: "text" },
          { name: "items", type: "array", fields: navItem },
        ] },
        { name: "featureCard", type: "group", fields: [{ name: "title", type: "text" }, { name: "href", type: "text" }] },
      ],
    },
    { name: "cta", type: "array", fields: [{ name: "label", type: "text" }, { name: "href", type: "text" }] },
  ],
};

export const Footer: GlobalConfig = {
  slug: "footer",
  admin: { group: "Site" },
  access: { read: () => true, update: hasRole("content-admin", "technical-admin") },
  fields: [
    { name: "site", type: "select", options: ["satelink", "jakuraa"], defaultValue: "satelink" },
    { name: "columns", type: "array", fields: [
      { name: "title", type: "text" },
      { name: "links", type: "array", fields: [
        { name: "label", type: "text" }, { name: "href", type: "text" },
        { name: "hideWhenEmptyCollection", type: "text" },
      ] },
    ] },
    { name: "social", type: "array", fields: [{ name: "platform", type: "text" }, { name: "href", type: "text" }] },
  ],
};

export const SiteSettings: GlobalConfig = {
  slug: "site-settings",
  admin: { group: "Site" },
  access: { read: () => true, update: hasRole("technical-admin", "content-admin") },
  fields: [
    { name: "site", type: "select", options: ["satelink", "jakuraa"], defaultValue: "satelink" },
    { name: "wordmark", type: "text" },
    { name: "defaultOgImage", type: "upload", relationTo: "media" },
    { name: "social", type: "array", fields: [{ name: "platform", type: "text" }, { name: "href", type: "text" }] },
  ],
};

export const SEODefaults: GlobalConfig = {
  slug: "seo-defaults",
  admin: { group: "Site" },
  access: { read: () => true, update: hasRole("seo-admin", "technical-admin") },
  fields: [
    { name: "titleTemplate", type: "text", defaultValue: "%s | Satelink" },
    { name: "description", type: "textarea" },
    { name: "ogImage", type: "upload", relationTo: "media" },
    { name: "twitterHandle", type: "text" },
  ],
};

export const RobotsConfig: GlobalConfig = {
  slug: "robots-config",
  admin: { group: "Site" },
  access: { read: () => true, update: hasRole("technical-admin") },
  fields: [
    { name: "allow", type: "array", fields: [{ name: "path", type: "text" }] },
    { name: "disallow", type: "array", fields: [{ name: "path", type: "text" }] },
    { name: "sitemapUrl", type: "text" },
  ],
};

export const globals: GlobalConfig[] = [Navigation, Footer, SiteSettings, SEODefaults, RobotsConfig];
