// Legal / policy pages (§3, §8). Published as "Review" — each carries an
// under-review note. Content is conservative and specific to how Satelink
// actually operates (no fabricated certifications, SLAs, or commitments). The
// controlling entity and contact come from @satelink/content.
import { LEGAL_ENTITY } from "@satelink/content";

export const LEGAL_CONTACT = "satelinknetwork@gmail.com";
export const LEGAL_UPDATED = "2026-09-23";

export interface LegalDoc {
  slug: string;
  title: string;
  intro: string;
  sections: { heading: string; body: string[] }[];
}

export const LEGAL: Record<string, LegalDoc> = {
  "acceptable-use": {
    slug: "acceptable-use",
    title: "Acceptable Use Policy",
    intro: "This policy describes how the Satelink API and website may be used. It applies to everyone who calls the API or uses the site.",
    sections: [
      { heading: "Permitted use", body: ["You may call the metered API for lawful purposes, subject to your balance and any per-key limits."] },
      { heading: "Prohibited use", body: [
        "Do not use the service for unlawful activity, to infringe others' rights, or to attempt to gain unauthorized access to systems.",
        "Do not attempt to overwhelm, degrade, or circumvent rate limits or metering on the gateway.",
        "Do not redistribute raw upstream data as if it were your own feed; Trading Intelligence returns derived statistics only.",
      ] },
      { heading: "Enforcement", body: ["We may rate-limit, suspend, or revoke access that violates this policy. Questions: " + LEGAL_CONTACT + "."] },
    ],
  },
  cookies: {
    slug: "cookies",
    title: "Cookie Policy",
    intro: "This page explains the small amount of browser storage the Satelink website uses.",
    sections: [
      { heading: "Essential storage", body: ["The site stores a theme preference (light/dark) in your browser's local storage. This is a per-device convenience and is never sent to a server."] },
      { heading: "Analytics", body: ["Where enabled, privacy-respecting product analytics may record aggregate page views. We do not sell personal data."] },
      { heading: "Your control", body: ["You can clear site data in your browser at any time; the site continues to work without stored preferences."] },
    ],
  },
  security: {
    slug: "security",
    title: "Security",
    intro: "How Satelink handles keys, spend, and settlement — and how to reach us about security.",
    sections: [
      { heading: "Keys and spend", body: ["API keys are scoped and rotatable. Spend cannot exceed a prepaid balance, and per-key limits bound exposure further."] },
      { heading: "On-chain settlement", body: ["Revenue settles on-chain to a permissionless Polygon vault, so settlement is publicly verifiable."] },
      { heading: "Reporting", body: ["To report a security issue, see the Responsible Disclosure policy or email " + LEGAL_CONTACT + ". We do not claim certifications we do not hold."] },
    ],
  },
  "responsible-disclosure": {
    slug: "responsible-disclosure",
    title: "Responsible Disclosure",
    intro: "We welcome reports of security vulnerabilities and will work with researchers acting in good faith.",
    sections: [
      { heading: "How to report", body: ["Email " + LEGAL_CONTACT + " with a clear description and steps to reproduce. Please give us reasonable time to respond before public disclosure."] },
      { heading: "Good-faith research", body: ["Do not access or modify data that is not yours, degrade service for others, or exfiltrate data. Testing must stay within these bounds."] },
      { heading: "Scope", body: ["The Satelink website and public API endpoints are in scope. Third-party services we integrate with are governed by their own programs."] },
    ],
  },
  "data-processing": {
    slug: "data-processing",
    title: "Data Processing",
    intro: "What personal data Satelink processes, and on what basis.",
    sections: [
      { heading: "What we process", body: ["Enquiry-form submissions (name, email, company, message) and operational request logs necessary to run and meter the service."] },
      { heading: "Controller", body: [`The controlling entity is ${LEGAL_ENTITY.name}, ${LEGAL_ENTITY.addressOneLine}.`] },
      { heading: "Your requests", body: ["To access, correct, or delete your data, contact " + LEGAL_CONTACT + ". This page will be updated as our data-processing terms are finalized."] },
    ],
  },
};

export const LEGAL_ORDER = ["acceptable-use", "cookies", "security", "responsible-disclosure", "data-processing"];

export function getLegal(slug: string): LegalDoc | undefined {
  return LEGAL[slug];
}
