// Legal / policy pages (web-v3 P4). Published as CMS "Review" drafts — each
// carries a "Draft pending legal review" banner and a plain-English summary.
// Content is conservative and specific to how Satelink actually operates: no
// fabricated certifications, SLAs, or commitments. Written to the applicable
// Indian and international data-protection standards (DPDP Act 2023 + Rules 2025,
// IT Act 2000 + SPDI Rules, GDPR/UK GDPR, CCPA/CPRA, Consumer Protection
// (E-Commerce) Rules 2020). Founder + Indian counsel must approve before publish.
import { LEGAL_ENTITY } from "@satelink/content";

export const LEGAL_CONTACT = "satelinknetwork@gmail.com";
export const LEGAL_UPDATED = "2026-09-23";
const ENTITY = LEGAL_ENTITY.name;
const ADDRESS = LEGAL_ENTITY.addressOneLine;

export interface LegalSection {
  heading: string;
  body?: string[];
  list?: string[];
  table?: { headers: string[]; rows: string[][] };
}
export interface LegalVersion {
  version: string;
  date: string;
  note: string;
}
export interface LegalDoc {
  slug: string;
  title: string;
  version: string;
  updated?: string;
  summary: string[];
  intro: string;
  sections: LegalSection[];
  versionHistory?: LegalVersion[];
}

const V1 = (note: string): LegalVersion[] => [{ version: "1.0", date: LEGAL_UPDATED, note }];

export const LEGAL: Record<string, LegalDoc> = {
  terms: {
    slug: "terms",
    title: "Terms of Service",
    version: "2.0",
    summary: [
      `Satelink is operated by ${ENTITY} (Coimbatore, India). You must be 18+ and may use the service for business purposes.`,
      "We sell derived analytics and metered RPC — priced per call. This is not investment advice, and we never take custody of your funds.",
      "Card/UPI payments are handled by Dodo Payments as Merchant of Record; x402 and USDT are your own on-chain transfers and are irreversible.",
      "Credits are prepaid service usage — not stored value, not transferable, and not redeemable for cash.",
      "Indian law governs; courts at Coimbatore have jurisdiction, with an arbitration option.",
    ],
    intro:
      `These Terms of Service ("Terms") govern your access to and use of the Satelink website, API, and services (the "Services"), operated by ${ENTITY}, ${ADDRESS} ("Satelink", "we", "us"). By accessing or using the Services you agree to these Terms. If you use the Services on behalf of an organization, you agree on its behalf.`,
    sections: [
      { heading: "Eligibility and accounts", body: [
        "You must be at least 18 years old and able to form a binding contract. The Services are intended for business and developer use; they are not directed to children.",
        "You may sign in with email and password, or with Google. You are responsible for keeping your credentials and API keys secure, and for all activity under your account or keys — including the activity of any autonomous agent you deploy with them.",
      ] },
      { heading: "The Services", body: [
        "Satelink provides (a) derived Trading Intelligence — statistics computed from public market data; (b) a metered blockchain RPC gateway; and (c) machine-payment rails (x402, USDT, and prepaid credits). Discovery and pricing are published as public machine-readable JSON.",
        "Trading Intelligence returns derived analytics only. It is not investment, financial, legal, or tax advice, and no output is a recommendation to buy or sell any asset. You are solely responsible for decisions you make.",
      ] },
      { heading: "Acceptable use", body: [
        "Your use is subject to our Acceptable Use Policy, which is incorporated into these Terms by reference. Violations may result in rate-limiting, suspension, or termination.",
      ] },
      { heading: "Plans, credits, and payment rails", body: [
        "The Services are sold as plans (where available), one-time credit packs, and per-call usage. Credits are prepaid service usage denominated in USD: they are not stored value, not transferable, not redeemable for cash, and expire only as stated in the Billing & Payment Policy.",
        "Card and UPI payments are processed by Dodo Payments, which acts as the Merchant of Record and seller of record and is responsible for charging and remitting applicable taxes. x402 and USDT payments are customer-initiated on-chain transfers: they are irreversible, and network (gas) fees are borne by the payer. Where plans are offered as subscriptions, renewal and cancellation are governed by the Billing & Payment Policy.",
      ] },
      { heading: "Refunds and chargebacks", body: [
        "Refunds are governed by the Refund & Cancellation Policy. Initiating a chargeback for a legitimately delivered service may result in suspension of your account while the dispute is resolved.",
      ] },
      { heading: "Third-party data and services", body: [
        "The Services rely on public market data, upstream RPC providers, payment processors, and blockchain networks. We do not warrant the accuracy, completeness, or availability of third-party data, and on-chain data is public and permanent.",
      ] },
      { heading: "Intellectual property", body: [
        "Satelink and its licensors retain all rights in the Services. You retain rights in your own content and applications. You may not resell or redistribute raw upstream data or the derived outputs as your own feed without a written agreement.",
      ] },
      { heading: "Disclaimers and limitation of liability", body: [
        'The Services are provided "as is" and "as available", without warranties of any kind to the extent permitted by law. To the maximum extent permitted by applicable law, Satelink is not liable for indirect, incidental, or consequential damages, and our aggregate liability is limited to the amounts you paid for the Services in the three months preceding the claim.',
      ] },
      { heading: "Indemnity", body: [
        "You agree to indemnify Satelink against claims arising from your use of the Services in breach of these Terms or applicable law, including the acts of agents you operate.",
      ] },
      { heading: "Governing law and disputes", body: [
        "These Terms are governed by the laws of India. Subject to the arbitration option below, the courts at Coimbatore, Tamil Nadu have exclusive jurisdiction. The parties may agree to resolve disputes by arbitration seated in Coimbatore under the Arbitration and Conciliation Act, 1996.",
      ] },
      { heading: "Node operators", body: [
        "If you run a node on the Satelink network, additional obligations apply under the Node Operator Terms at /network/operator-terms, which supplement these Terms.",
      ] },
      { heading: "Changes and contact", body: [
        `We may update these Terms; material changes will be posted here with a new version and date. Questions: ${LEGAL_CONTACT}.`,
      ] },
    ],
    versionHistory: [
      { version: "2.0", date: LEGAL_UPDATED, note: "Restructured for the machine-commerce model; node-operator terms moved to /network/operator-terms; payment-rail, credits, and MoR terms added." },
      { version: "1.0", date: "2026-05-19", note: "Initial terms migrated from the static site." },
    ],
  },

  privacy: {
    slug: "privacy",
    title: "Privacy Policy",
    version: "2.0",
    summary: [
      `${ENTITY} is the data fiduciary/controller. Contact our Grievance Officer at ${LEGAL_CONTACT}.`,
      "We collect account and sign-in details, API usage and IP/device data, wallet addresses, payment metadata from Dodo (never card numbers), enquiries, and cookies.",
      "We keep data only as long as needed for each purpose (see the retention table) and use a small set of named sub-processors.",
      "You can access, correct, or erase your data, and raise a grievance. On-chain data is public and permanent.",
    ],
    intro:
      `This Privacy Policy explains how ${ENTITY}, ${ADDRESS} ("Satelink") collects, uses, shares, and protects personal data, and your rights under the Digital Personal Data Protection Act, 2023 and its 2025 Rules, the Information Technology Act, 2000 and the SPDI Rules, the EU/UK GDPR, and the CCPA/CPRA where applicable.`,
    sections: [
      { heading: "Controller and Grievance Officer", body: [
        `The data fiduciary and controller is ${ENTITY}, ${ADDRESS}. For privacy requests and grievances under the DPDP Act, contact the Grievance Officer at ${LEGAL_CONTACT}. (The named officer will be designated before this policy is published.)`,
      ] },
      { heading: "Data we collect, by category", table: {
        headers: ["Category", "Examples"],
        rows: [
          ["Account", "Name, email, password hash, organization"],
          ["Auth provider profile", "Basic profile from Google sign-in (email, name)"],
          ["API usage", "Requests, endpoints, keys used, call counts, timestamps"],
          ["Device / network", "IP address, user agent, coarse location derived from IP"],
          ["Wallet", "Public wallet addresses used on the x402/USDT rail"],
          ["Payment metadata", "From Dodo: amount, currency, status, last-4/brand — never full card numbers"],
          ["Enquiries", "Contact-sales, support, and feedback submissions"],
          ["Cookies / storage", "Theme preference and, where enabled, cookieless analytics"],
        ],
      } },
      { heading: "Purposes and lawful basis", body: [
        "We process personal data to provide and meter the Services (performance of a contract), to secure the platform and prevent abuse (legitimate interests / legal obligation), to process payments (contract, via Dodo), to respond to enquiries (consent / legitimate interests), and to comply with law. Under the DPDP Act, processing is based on your consent or on legitimate uses as defined by the Act.",
      ] },
      { heading: "Consent and withdrawal", body: [
        "Where we rely on consent, you may withdraw it at any time; withdrawal does not affect processing already carried out. You can manage sign-in methods and delete your account from the console.",
      ] },
      { heading: "Retention", body: ["We keep each category only as long as necessary:"], table: {
        headers: ["Category", "Retention"],
        rows: [
          ["Account", "For the life of the account, then up to 90 days after deletion"],
          ["API usage logs", "Up to 12 months, then aggregated or deleted"],
          ["Payment metadata", "As required for tax/audit (typically up to 8 years)"],
          ["Enquiries", "Up to 24 months from last contact"],
          ["Security logs", "Up to 12 months"],
        ],
      } },
      { heading: "Sub-processors", body: [
        "We use a small set of processors to run the Services. On-chain data is public and permanent and is not controlled by any processor. The current list is maintained at /sub-processors and includes Vercel, Railway, Dodo Payments, Google, our email provider, the x402 facilitator, and the blockchain networks we settle on.",
      ] },
      { heading: "Cross-border transfers", body: [
        "Some processors are located outside India. Where personal data is transferred internationally, we rely on the transfer mechanisms permitted by applicable law and take steps to ensure an adequate level of protection.",
      ] },
      { heading: "Security safeguards", body: [
        "We use TLS in transit, store API keys hashed, enforce least-privilege access and 2FA for administrative access, and log administrative actions. No method is perfectly secure; see the Security page for what we do and do not claim.",
      ] },
      { heading: "Breach notification", body: [
        "In the event of a personal-data breach, we will notify the Data Protection Board of India and affected users as required by the DPDP Act and its Rules, and other regulators where applicable.",
      ] },
      { heading: "Your rights", body: [
        "Subject to applicable law, you may request access to, correction of, or erasure of your personal data; nominate another person to exercise your rights (DPDP); and, under the GDPR, object to or restrict processing and request portability. We aim to respond within the timelines set by the applicable law. To exercise a right or raise a grievance, contact the Grievance Officer.",
      ] },
      { heading: "Children and automated decisions", body: [
        "The Services are not directed to individuals under 18, and we do not knowingly process children's data. We do not make decisions producing legal effects solely by automated means.",
      ] },
      { heading: "Changes and contact", body: [
        `We will post changes here with a new version and date. Contact: ${LEGAL_CONTACT}.`,
      ] },
    ],
    versionHistory: [
      { version: "2.0", date: LEGAL_UPDATED, note: "DPDP Grievance Officer, data-category and retention tables, sub-processors, breach notification, and expanded rights added." },
      { version: "1.0", date: "2026-05-19", note: "Initial privacy notice." },
    ],
  },

  "billing-policy": {
    slug: "billing-policy",
    title: "Billing & Payment Policy",
    version: "1.0",
    summary: [
      "Card and UPI payments are handled by Dodo Payments as Merchant of Record; Satelink never sees your full card number.",
      "x402 and USDT are your own on-chain transfers — irreversible, with network fees paid by you.",
      "Credits are prepaid service usage and do not expire while your account is open. Receipts and invoices come from Dodo.",
      "Plan changes, failed payments, and disputes are handled as described below.",
    ],
    intro:
      "This Billing & Payment Policy explains how payments, currencies, taxes, invoices, plan changes, and disputes work across Satelink's two payment rails: the fiat rail (card/UPI via Dodo Payments) and the crypto rail (x402/USDT).",
    sections: [
      { heading: "Payment rails", body: ["Satelink supports two independent rails:"], table: {
        headers: ["Rail", "Methods", "Processor", "Reversible?"],
        rows: [
          ["Fiat", "Card, UPI", "Dodo Payments (Merchant of Record)", "Via Dodo refund"],
          ["Crypto", "x402 (USDC on Base), USDT (Polygon)", "On-chain, customer-initiated", "No (irreversible)"],
        ],
      } },
      { heading: "What Satelink sees vs what Dodo sees", body: [
        "For card/UPI, Dodo is the seller of record: it collects payment, performs KYC/anti-fraud, handles tax, and remits the net amount to Satelink. Satelink receives payment metadata (amount, currency, status, card brand/last-4) but never your full card number. For the crypto rail, the transfer happens on a public blockchain; Satelink sees the on-chain transaction and your wallet address.",
      ] },
      { heading: "Currency and taxes", body: [
        "Prices are shown in USD. As Merchant of Record, Dodo determines and collects any applicable sales tax, VAT, or GST for card/UPI purchases and issues the corresponding tax documentation. Crypto-rail transfers are made in the stated stablecoin and do not include tax handling by Satelink.",
      ] },
      { heading: "Invoices and receipts", body: [
        "Card/UPI receipts and invoices are issued by Dodo and are available from your Dodo customer portal, linked in the console Billing area. On-chain payments produce a verifiable transaction hash.",
      ] },
      { heading: "Credits and expiry", body: [
        "Credits are prepaid service usage denominated in USD — not stored value, not transferable, and not redeemable for cash. Credits do not expire while your account remains open; on account closure, unused credit is handled as described in the Refund & Cancellation Policy.",
      ] },
      { heading: "Plan changes and proration", body: [
        "Where recurring plans are available, upgrading takes effect immediately and is prorated; downgrading takes effect at the end of the current billing period. Included monthly call allowances reset at the start of each period and do not roll over.",
      ] },
      { heading: "Failed payments and retries", body: [
        "If a subscription payment fails, Dodo may retry per its standard schedule. During a failed or on-hold state, plan benefits may be paused until payment succeeds; pay-as-you-go usage continues to draw from any available credit balance.",
      ] },
      { heading: "Free tier and quotas", body: [
        "The free tier lets you evaluate the Services without payment, subject to a monthly call quota and a lower rate limit. When you exhaust the free quota you can upgrade to a paid plan or buy a credit pack; the free tier is not a paid product and carries no billing obligations.",
      ] },
      { heading: "Spend controls", body: [
        "Because usage is metered, we provide controls to bound spend: a prepaid balance that usage cannot exceed, and per-key rate limits and spend caps. We recommend setting spend caps on any key used by an autonomous agent so that a fault cannot cause runaway charges.",
      ] },
      { heading: "Which balance funds which product", body: [
        "Card/UPI credit purchased through Dodo is spendable on Trading Intelligence. The crypto rail (x402/USDT) funds RPC and the machine endpoints. This boundary is disclosed on the pricing page and enforced in the platform; it exists so that regulated payment value and crypto value stay in their respective lanes.",
      ] },
      { heading: "Price changes", body: [
        "We may change prices or plan features. Where you are on a recurring plan, we will give reasonable notice of a price change before it takes effect at your next renewal, and you may cancel before then. Published per-call rates may change for future usage; usage already paid for is not repriced.",
      ] },
      { heading: "Disputes", body: [
        `Contact us first at ${LEGAL_CONTACT} — most issues are resolved quickly. A chargeback on a legitimately delivered service may lead to suspension while the dispute is investigated. Dispute fees charged to Satelink are not passed on to you.`,
      ] },
    ],
    versionHistory: V1("Initial billing & payment policy covering both rails and Merchant-of-Record handling."),
  },

  refund: {
    slug: "refund",
    title: "Refund & Cancellation Policy",
    version: "2.0",
    summary: [
      "Dodo-confirmed refunds automatically claw back unused credits, proportionally.",
      "Credits already spent on calls are non-refundable.",
      "x402/USDT transfers are irreversible — no refund except in the case of a service failure.",
      "Subscriptions cancel at the end of the current period; no partial refund unless required by law.",
    ],
    intro:
      "This Refund & Cancellation Policy explains how refunds, cancellations, and reversals work across Satelink's plans, credit packs, and payment rails. It supplements the Terms of Service and Billing & Payment Policy.",
    sections: [
      { heading: "Credit packs (card/UPI via Dodo)", body: [
        "When Dodo confirms a refund for a credit pack, Satelink automatically claws back the unused portion of the corresponding credits; a partial refund reverses credits proportionally. Credits already spent on completed calls have been delivered as a service and are non-refundable.",
      ] },
      { heading: "Subscriptions", body: [
        "Where recurring plans are offered, you may cancel at any time from the console. Cancellation takes effect at the end of the current billing period, and access continues until then. We do not provide partial refunds for the unused part of a period unless required by applicable law.",
      ] },
      { heading: "Crypto rail (x402 / USDT)", body: [
        "On-chain transfers are irreversible. We do not refund crypto-rail payments except where a paid call failed to deliver the service due to a fault on our side; in that case, contact us with the transaction hash and we will restore the equivalent credit.",
      ] },
      { heading: "How to request a refund", body: [
        `Email ${LEGAL_CONTACT} from your account email with the order or transaction reference. We aim to acknowledge within a few business days.`,
      ] },
      { heading: "Timelines", body: [
        "Approved card/UPI refunds are processed by Dodo and typically appear within your bank's standard processing time. Credit adjustments on your Satelink balance are applied when the refund is confirmed.",
      ] },
      { heading: "Duplicate or erroneous charges", body: [
        "If you are charged in error — for example a duplicate charge or a charge for a service that was not provided — contact us and we will investigate and, where confirmed, arrange a refund of the affected amount through the original payment method or as a credit adjustment.",
      ] },
      { heading: "Free tier", body: [
        "The free tier involves no payment and therefore has nothing to refund. Moving from free to a paid plan or a credit pack is governed by the paid-purchase terms above.",
      ] },
      { heading: "Chargebacks", body: [
        "If you have a billing concern, please contact us first — most issues are resolved quickly. Initiating a chargeback against a legitimately delivered service may result in suspension of your account while the dispute is investigated with the payment processor.",
      ] },
      { heading: "Currency and taxes", body: [
        "Refunds are made in the original currency of the transaction. As Merchant of Record for card/UPI, Dodo handles any tax adjustments associated with a refund. Network fees on the crypto rail are not refundable, as they are paid to the network and not to Satelink.",
      ] },
      { heading: "Consumer rights", body: [
        "Nothing in this policy limits any non-waivable rights you may have as a consumer under applicable law, including the Consumer Protection (E-Commerce) Rules, 2020 where they apply. Where mandatory law grants you a stronger remedy, that law prevails.",
      ] },
      { heading: "Fees", body: [
        "The per-refund processing fee is Satelink's cost and is not charged to you.",
      ] },
      { heading: "Account closure", body: [
        "On account closure, any unused, refundable credit is handled per this policy; spent and non-refundable credit is not returned. If you would like your remaining balance reviewed for a refund on closure, contact us with your account details.",
      ] },
      { heading: "Contact and timelines", body: [
        `The fastest way to resolve a billing question is to email ${LEGAL_CONTACT} from your account email with the order or transaction reference; we aim to acknowledge within a few business days. Where a refund is approved, card and UPI refunds are processed by Dodo and appear within your bank's standard timeframe, and credit adjustments on your Satelink balance are applied as soon as the refund is confirmed. If we ever need more information from you to process a refund, we will ask promptly so it is not delayed.`,
      ] },
    ],
    versionHistory: [
      { version: "2.0", date: LEGAL_UPDATED, note: "Added subscription cancellation and crypto-rail (x402/USDT) treatment." },
      { version: "1.0", date: "2026-05-19", note: "Initial refund mechanics for credit packs." },
    ],
  },

  "acceptable-use": {
    slug: "acceptable-use",
    title: "Acceptable Use Policy",
    version: "2.0",
    summary: [
      "Use the Services lawfully and within your balance and rate limits.",
      "No market manipulation, data resale without agreement, scraping/abuse, key sharing, or sanctions violations.",
      "You are responsible for the agents you operate.",
      "We enforce with warnings, rate-limiting, suspension, and termination.",
    ],
    intro:
      "This Acceptable Use Policy (\"AUP\") applies to everyone who uses the Satelink website, API, or agents built on it. It is incorporated into the Terms of Service.",
    sections: [
      { heading: "Permitted use", body: [
        "You may call the metered API for lawful purposes, subject to your balance, plan, and any per-key rate limits and spend caps. You may build products and agents on top of the Services within these Terms.",
      ] },
      { heading: "Prohibited uses", list: [
        "Unlawful activity, or activity that infringes others' rights or violates applicable financial regulation.",
        "Market manipulation, or using Satelink data to facilitate manipulative or deceptive trading practices.",
        "Redistributing or reselling raw upstream data, or the derived Trading Intelligence outputs, as your own feed without a written agreement.",
        "Scraping, abuse, or attempts to overwhelm, degrade, or circumvent rate limits, metering, or authentication on the gateway.",
        "Sharing, selling, or publishing API keys, or attempting to gain unauthorized access to systems or other users' data.",
        "Circumventing spend caps, quotas, or plan limits.",
        "Use in connection with sanctioned persons, entities, or jurisdictions, or otherwise in violation of applicable export-control or sanctions law.",
      ] },
      { heading: "Fair use and rate limits", body: [
        "Access is metered and rate-limited. You must not attempt to exceed, evade, or disguise usage to get around plan quotas, per-key rate limits, spend caps, or the free-tier gate — for example by rotating keys, distributing calls across accounts to dodge limits, or falsifying identifiers. Automated traffic is welcome within your limits; traffic engineered to degrade the service for others is not.",
      ] },
      { heading: "Data use and redistribution", body: [
        "Trading Intelligence returns derived statistics computed from public market data. You may use these outputs in your own products and decisions, but you may not resell or redistribute the raw upstream data, or the derived outputs, as a competing data feed without a separate written agreement. Do not represent Satelink data as your own proprietary feed, and do not use it to build a substantially similar competing catalog for resale.",
      ] },
      { heading: "Security testing", body: [
        "Do not perform security testing against the Services except in accordance with our Responsible Disclosure policy. Unauthorized penetration testing, load testing, or attempts to bypass authentication are prohibited.",
      ] },
      { heading: "Sanctions and export compliance", body: [
        "You represent that you are not located in, or acting on behalf of anyone in, a sanctioned jurisdiction, and that you are not a person or entity subject to applicable sanctions or export-control restrictions. You will not use the Services in violation of such laws.",
      ] },
      { heading: "Agent operator responsibility", body: [
        "If you deploy autonomous agents that call the Services, you are responsible for their behavior, spend, and compliance with this AUP as if the actions were your own. You must implement appropriate spend caps, rate limiting, and monitoring so that a malfunctioning or compromised agent cannot cause runaway spend or abusive traffic. The fact that an action was taken automatically by an agent does not excuse a violation.",
      ] },
      { heading: "Enforcement ladder", body: [
        "We enforce proportionately. For minor or first violations we may issue a warning or apply an automated rate-limit. For repeated or serious violations we may temporarily suspend your account or keys. For severe, unlawful, or persistent abuse we may revoke access and terminate your account. Where necessary to protect the platform, other users, or to comply with law, we may act immediately and without prior notice.",
      ] },
      { heading: "Appeals", body: [
        `If you believe an enforcement action was made in error, contact ${LEGAL_CONTACT} with your account details and an explanation, and we will review it.`,
      ] },
      { heading: "Reporting and contact", body: [
        `To report abuse or ask whether a particular use is permitted, email ${LEGAL_CONTACT}.`,
      ] },
    ],
    versionHistory: [
      { version: "2.0", date: LEGAL_UPDATED, note: "Expanded prohibited uses (manipulation, resale, sanctions), agent-operator responsibility, and an enforcement ladder." },
      { version: "1.0", date: "2026-05-19", note: "Initial acceptable-use policy." },
    ],
  },

  "data-processing": {
    slug: "data-processing",
    title: "Data Processing Addendum",
    version: "2.0",
    summary: [
      "For business customers whose use involves Satelink processing personal data on their behalf.",
      "Satelink acts as a processor/data processor; the customer is the controller/data fiduciary.",
      "We process only on documented instructions, keep the data confidential, and use vetted sub-processors.",
      "We assist with data-subject requests and breach notification and delete or return data on termination.",
    ],
    intro:
      `This Data Processing Addendum ("DPA") supplements the Terms of Service for business ("B2B") customers where Satelink processes personal data on the customer's behalf. It reflects obligations under the DPDP Act, 2023 and the GDPR where applicable. It is offered by ${ENTITY}.`,
    sections: [
      { heading: "Roles", body: [
        "For personal data the customer submits or generates through the Services, the customer is the controller / data fiduciary and Satelink is the processor / data processor. For Satelink's own account and billing data, Satelink is the controller.",
      ] },
      { heading: "Scope and instructions", body: [
        "Satelink processes personal data only to provide the Services and on the customer's documented instructions (including these Terms), unless required by law, in which case Satelink will inform the customer where permitted.",
      ] },
      { heading: "Confidentiality and security", body: [
        "Satelink keeps personal data confidential, limits access to personnel who need it, and applies the safeguards described in the Security page and Privacy Policy.",
      ] },
      { heading: "Sub-processors", body: [
        "The customer authorizes Satelink to engage the sub-processors listed at /sub-processors. Satelink imposes data-protection obligations on sub-processors and remains responsible for their performance, and will give notice of intended changes.",
      ] },
      { heading: "Data-subject requests", body: [
        "Satelink will assist the customer, taking into account the nature of processing, in responding to requests from data principals / data subjects (access, correction, erasure, and similar).",
      ] },
      { heading: "Breach notification", body: [
        "Satelink will notify the customer without undue delay after becoming aware of a personal-data breach affecting the customer's data, with the information the customer needs to meet its own obligations.",
      ] },
      { heading: "International transfers", body: [
        "Where personal data is transferred across borders, the parties rely on the mechanisms permitted by applicable law.",
      ] },
      { heading: "Categories of data and data subjects", body: [
        "The personal data processed under this DPA typically includes account and contact details, authentication identifiers, API usage and device/network data, wallet addresses, and payment metadata. The data subjects are typically the customer's personnel and end users who interact with the customer's application built on the Services. The nature and purpose of processing is the provision, metering, and support of the Services.",
      ] },
      { heading: "Duration of processing", body: [
        "Satelink processes personal data for the duration of the agreement and for the retention periods set out in the Privacy Policy, after which the data is deleted or returned as described below.",
      ] },
      { heading: "Personnel and confidentiality", body: [
        "Satelink ensures that personnel authorized to process the customer's personal data are bound by appropriate confidentiality obligations and are granted access only on a need-to-know basis.",
      ] },
      { heading: "Assistance and records", body: [
        "Taking into account the nature of processing and the information available to it, Satelink will provide reasonable assistance to the customer in meeting its own obligations, including in relation to security, breach notification, and data-protection impact assessments. Satelink maintains records of the processing it carries out on the customer's behalf.",
      ] },
      { heading: "Audit", body: [
        "On reasonable prior written request, and subject to confidentiality, Satelink will make available information necessary to demonstrate compliance with this DPA. Where a customer requires more, the parties will agree on a proportionate approach that does not compromise the security of other customers.",
      ] },
      { heading: "Liability and precedence", body: [
        "This DPA forms part of, and is governed by, the Terms of Service. In the event of a conflict between this DPA and the Terms on the subject of personal-data processing, this DPA prevails. Liability under this DPA is subject to the limitations set out in the Terms.",
      ] },
      { heading: "Return and deletion", body: [
        `On termination or expiry of the agreement, Satelink will, at the customer's choice, delete or return the customer's personal data, subject to any retention required by applicable law. Requests: ${LEGAL_CONTACT}.`,
      ] },
    ],
    versionHistory: [
      { version: "2.0", date: LEGAL_UPDATED, note: "Reframed as a B2B Data Processing Addendum with processor obligations and sub-processor terms." },
      { version: "1.0", date: LEGAL_UPDATED, note: "Initial data-processing note." },
    ],
  },

  cookies: {
    slug: "cookies",
    title: "Cookie Policy",
    version: "2.0",
    summary: [
      "The marketing site uses almost no cookies.",
      "We store a theme preference locally on your device; it is never sent to a server.",
      "Product analytics, where enabled, are cookieless (Vercel Web Analytics).",
      "You can clear site data any time and the site still works.",
    ],
    intro:
      "This Cookie Policy explains the small amount of browser storage and cookies the Satelink website uses.",
    sections: [
      { heading: "What we store", table: {
        headers: ["Name / type", "Purpose", "Duration"],
        rows: [
          ["satelink-theme (localStorage)", "Remembers light/dark theme", "Until cleared"],
          ["Session cookie (console)", "Keeps you signed in to the console", "Session / as configured"],
          ["Vercel Web Analytics", "Aggregate page views — cookieless", "No cookie set"],
        ],
      } },
      { heading: "Cookieless analytics", body: [
        "Where analytics are enabled, we use Vercel Web Analytics, which is cookieless and does not track you across sites. We do not sell personal data.",
      ] },
      { heading: "Your control", body: [
        "You can clear site data in your browser at any time; the site continues to work without stored preferences.",
      ] },
    ],
    versionHistory: V1("Added the storage table and the cookieless-analytics note."),
  },

  security: {
    slug: "security",
    title: "Security",
    version: "2.0",
    summary: [
      "We use TLS in transit and store API keys hashed.",
      "Administrative access uses least privilege and 2FA.",
      "Spend is bounded by your prepaid balance and per-key limits; settlement is publicly verifiable on-chain.",
      "We do not claim certifications we do not hold — report issues via Responsible Disclosure.",
    ],
    intro:
      "This page describes the security practices Satelink actually follows. We deliberately do not claim certifications (such as SOC 2 or ISO 27001) that we do not hold. Security is a continuous effort; this page is updated as our practices evolve, and we welcome reports through our Responsible Disclosure policy.",
    sections: [
      { heading: "Data in transit and at rest", body: [
        "Traffic to the website and API is served over TLS, so data is encrypted in transit between your client and our services. Secrets such as API keys are stored hashed rather than in plaintext, and a key's full value is shown only once, at the moment it is created; after that only a masked prefix is displayed.",
        "Application data is stored in managed database services provided by our hosting sub-processors, which apply their own encryption-at-rest and network controls.",
      ] },
      { heading: "Access control", body: [
        "Administrative access to production systems follows the principle of least privilege: people and services receive only the access they need. Administrative access requires two-factor authentication, and administrative actions on keys, billing, and configuration are recorded in an audit log so sensitive changes are attributable and reviewable.",
        "Access is reviewed periodically and revoked when it is no longer required.",
      ] },
      { heading: "API keys and agent keys", body: [
        "API keys are scoped and rotatable, so you can issue a key for a specific product or agent and revoke it without affecting the rest of your account. You are responsible for storing keys securely and for the activity of any agent you configure with them; if a key is exposed, rotate it immediately from the console.",
      ] },
      { heading: "Spend and abuse controls", body: [
        "Financial exposure is bounded by design: spend cannot exceed a prepaid balance, and per-key rate limits and spend caps limit the impact of a compromised key or a misbehaving agent. A free-tier gate limits anonymous abuse of the gateway, and repeated abusive traffic can be blocked at the network edge.",
      ] },
      { heading: "Payment security", body: [
        "Card and UPI payments are handled by Dodo Payments as Merchant of Record. Satelink never receives or stores full card numbers — that data stays within the payment processor's PCI-compliant environment. Satelink sees only payment metadata such as amount, currency, status, and card brand or last-4.",
      ] },
      { heading: "On-chain settlement", body: [
        "Revenue settles on-chain to a permissionless Polygon vault, so settlement is publicly verifiable rather than opaque. On-chain data is public and permanent by nature; do not put anything private in a transaction.",
      ] },
      { heading: "Sub-processor security", body: [
        "We rely on established hosting and payment sub-processors (see /sub-processors) and depend in part on the security controls they operate. We select processors with credible security practices and impose data-protection obligations on them.",
      ] },
      { heading: "Backups and availability", body: [
        "Application data is stored in managed services that provide backups and redundancy operated by our hosting sub-processors. We do not promise a specific uptime figure on this page; where an availability commitment exists it will be stated in a separate agreement.",
      ] },
      { heading: "Incident response", body: [
        "If we become aware of a security incident affecting personal data, we will act to contain it and notify the Data Protection Board of India and affected users as required by the DPDP Act and its Rules, and other regulators where applicable. See the Privacy Policy for more on breach notification.",
      ] },
      { heading: "Reporting", body: [
        `To report a security issue, see the Responsible Disclosure policy or email ${LEGAL_CONTACT}. We investigate credible reports and work with good-faith researchers.`,
      ] },
      { heading: "What we do not claim", body: [
        "We do not currently hold third-party security certifications and do not represent otherwise. We describe only practices we actually follow; this page will be updated if our posture or certifications change.",
      ] },
    ],
    versionHistory: V1("Expanded to enumerate real practices (TLS, hashed keys, 2FA on admin, least privilege) and an explicit no-certifications statement."),
  },

  "sub-processors": {
    slug: "sub-processors",
    title: "Sub-processors",
    version: "1.0",
    summary: [
      "The third parties that help us run the Services.",
      "On-chain data is public and permanent and is not controlled by any processor.",
      "We update this list before adding a new sub-processor.",
    ],
    intro:
      "Satelink uses the following sub-processors to provide the Services. This list is maintained for transparency and referenced by our Privacy Policy and Data Processing Addendum.",
    sections: [
      { heading: "Current sub-processors", table: {
        headers: ["Sub-processor", "Purpose", "Region"],
        rows: [
          ["Vercel", "Website hosting and analytics", "Global (US)"],
          ["Railway", "API and database hosting", "Global (US)"],
          ["Dodo Payments", "Card/UPI payments (Merchant of Record)", "Global"],
          ["Google", "Sign in with Google", "Global"],
          ["Email provider", "Transactional email (verification, receipts)", "Global"],
          ["x402 facilitator", "x402 payment settlement", "Global"],
          ["Blockchain networks (Polygon, Base)", "On-chain settlement — public and permanent", "Public networks"],
        ],
      } },
      { heading: "Changes", body: [
        `We will update this page before engaging a new sub-processor. Questions: ${LEGAL_CONTACT}.`,
      ] },
    ],
    versionHistory: V1("Initial sub-processor list."),
  },

  "operator-terms": {
    slug: "operator-terms",
    title: "Node Operator Terms",
    version: "1.0",
    summary: [
      "Additional terms for anyone running a node on the Satelink network.",
      "Rewards follow the published split (50% node operators / 30% platform / 20% distribution pool).",
      "Earnings depend on real settled traffic — they are not guaranteed.",
      "You are responsible for your infrastructure, uptime, and legal compliance.",
    ],
    intro:
      `These Node Operator Terms supplement the Terms of Service for anyone who runs a node on the Satelink network. They are offered by ${ENTITY}.`,
    sections: [
      { heading: "Eligibility and registration", body: [
        "You must register a node via the node onboarding flow, keep your operator details accurate, and comply with applicable law in your jurisdiction.",
      ] },
      { heading: "Responsibilities", list: [
        "Maintain your own infrastructure, connectivity, and reasonable uptime.",
        "Serve requests honestly and do not tamper with responses or metering.",
        "Keep operator keys secure and report suspected compromise.",
      ] },
      { heading: "Rewards and settlement", body: [
        "Where you are eligible for rewards, revenue is aggregated per epoch and settled on-chain per the published economic split (50% node operators / 30% platform / 20% distribution pool). Earnings depend on real settled traffic and are not guaranteed; there is no promise of any particular income.",
      ] },
      { heading: "Suspension and termination", body: [
        "We may suspend or remove a node that violates these terms, degrades the network, or acts unlawfully.",
      ] },
      { heading: "Contact", body: [`Questions: ${LEGAL_CONTACT}.`] },
    ],
    versionHistory: V1("Node-operator obligations moved out of the main Terms into a dedicated page."),
  },

  "responsible-disclosure": {
    slug: "responsible-disclosure",
    title: "Responsible Disclosure",
    version: "2.0",
    summary: [
      "We welcome good-faith security reports.",
      `Email ${LEGAL_CONTACT} with clear reproduction steps and give us reasonable time to fix before disclosure.`,
      "Don't access others' data, degrade service, or exfiltrate data.",
      "The website and public API are in scope; third-party services follow their own programs.",
    ],
    intro:
      "We welcome reports of security vulnerabilities and will work in good faith with researchers who follow this policy. This policy explains how to report, what is in and out of scope, the rules of engagement, and the safe-harbour protection we offer to good-faith researchers.",
    sections: [
      { heading: "How to report", body: [
        `Email ${LEGAL_CONTACT} with a clear description, the affected endpoint or page, the impact, and step-by-step instructions to reproduce. Include any proof-of-concept in a form that does not itself cause harm. If your report contains sensitive details, say so and we will arrange a secure channel.`,
        "Please give us reasonable time to investigate and remediate before any public disclosure. We will keep you updated as we work through the issue, and we welcome a suggested remediation if you have one. There is no need to include real user data in your report; a minimal, self-contained proof-of-concept against your own account is ideal and helps us reproduce the issue quickly.",
      ] },
      { heading: "Rules of engagement", list: [
        "Only test against your own account, keys, and data — never another user's.",
        "Do not access, modify, or destroy data that is not yours.",
        "Do not degrade service for others (no denial-of-service, no load testing against production).",
        "Do not exfiltrate data; the minimum needed to demonstrate an issue is enough.",
        "Stop as soon as you have confirmed a vulnerability, and report it.",
      ] },
      { heading: "Safe harbour", body: [
        "If you make a good-faith effort to comply with this policy during your research, we will consider your testing authorized, will not pursue or support legal action against you for it, and will work with you to understand and resolve the issue quickly. This authorization does not extend to violating the privacy of others, disrupting our systems, or destroying data.",
      ] },
      { heading: "In scope", body: [
        "The Satelink website (satelink.network) and the public API endpoints under rpc.satelink.network are in scope. Vulnerabilities that could expose user data, allow account or key compromise, bypass metering or spend controls, or lead to unauthorized on-chain actions are of particular interest.",
      ] },
      { heading: "Out of scope", list: [
        "Third-party services we integrate with (payment processor, hosting providers, blockchain networks) — report those to their own programs.",
        "Reports from automated scanners without a demonstrated, exploitable impact.",
        "Best-practice suggestions without a concrete vulnerability (e.g. missing headers with no exploit).",
        "Social engineering, physical attacks, and denial-of-service.",
      ] },
      { heading: "Coordinated disclosure", body: [
        "We practice coordinated disclosure: we ask that you keep the details private until we have released a fix or a reasonable time has passed. We are happy to credit researchers who report valid issues, if you would like recognition.",
      ] },
      { heading: "What to expect", body: [
        "We aim to acknowledge reports promptly, triage them by severity and impact, and keep you informed through remediation. Complex issues can take time to fix correctly; we would rather ship a complete fix than a rushed one, and we will explain our reasoning if a fix will take a while.",
      ] },
      { heading: "Recognition", body: [
        "We are happy to credit researchers who report valid, previously unknown issues, if you would like public acknowledgement. Let us know how you would like to be named. We currently do not operate a paid bug-bounty program, and a report does not create an entitlement to payment.",
      ] },
      { heading: "Legal", body: [
        "This policy is not a waiver of any rights and does not authorize activity that would violate applicable law or the rights of third parties. It is offered in good faith to enable responsible security research on systems we operate. If you are unsure whether a specific test is permitted, ask us first before proceeding.",
      ] },
    ],
    versionHistory: [
      { version: "2.0", date: LEGAL_UPDATED, note: "Added good-faith safe-harbour language and expectations." },
      { version: "1.0", date: LEGAL_UPDATED, note: "Initial disclosure policy." },
    ],
  },
};

export const LEGAL_ORDER = [
  "terms",
  "privacy",
  "billing-policy",
  "refund",
  "acceptable-use",
  "data-processing",
  "cookies",
  "security",
  "sub-processors",
  "responsible-disclosure",
];

export function getLegal(slug: string): LegalDoc | undefined {
  return LEGAL[slug];
}
