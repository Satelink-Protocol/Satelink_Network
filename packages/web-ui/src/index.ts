// @satelink/web-ui — Satelink Signal public-website design system.
// Shared by apps/web (satelink.network) and apps/corporate (jakuraa.com).
// Consumes --sl-* tokens (./styles/tokens.css); independent of @satelink/ui,
// which is the OS/admin dashboard system scoped to .satelink-os.
export * from "./components/ui";
export { SiteHeader } from "./components/site/SiteHeader";
export { SiteFooter } from "./components/site/SiteFooter";
export { LiveNetworkStrip } from "./components/site/LiveNetworkStrip";
// Data-driven shell (§6/§7/§8/§14) — presentational; app supplies the data.
export { MegaMenuHeader } from "./components/site/MegaMenuHeader";
export type { MegaNav, MMMenu, MMItem, MMGroup, MMCta } from "./components/site/MegaMenuHeader";
export { DataFooter } from "./components/site/DataFooter";
export type { FooterData, FColumn, FLink } from "./components/site/DataFooter";
export { Breadcrumbs } from "./components/site/Breadcrumbs";
export type { Crumb } from "./components/site/Breadcrumbs";
export { SearchPalette } from "./components/site/SearchPalette";
export type { SearchHit, SearchFn } from "./components/site/SearchPalette";
export { cn } from "./lib/utils";
