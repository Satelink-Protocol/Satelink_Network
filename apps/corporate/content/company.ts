// Company facts — sourced ONLY from founder-supplied statutory documents
// (Certificate of Incorporation, GST registration, IEC, Udyam) and founder
// statements. Do not add figures, people, clients or locations that are not
// backed by a document. PAN/TAN, DIN, residential addresses, personal phone
// numbers and signatures must never be added here.

export const company = {
  legalName: "Jakuraa Commercial Private Limited",
  formerName: "Falcor Commercial Private Limited",
  shortName: "Jakuraa",
  cin: "U52190TZ2019PTC033093",
  incorporated: "2019-12-04",
  incorporatedDisplay: "4 December 2019",
  companyType: "Private company limited by shares, incorporated under the Companies Act, 2013",
  registeredOffice: {
    street: "38, 39, First Floor, Malaviya Street, Ramnagar",
    locality: "Coimbatore",
    region: "Tamil Nadu",
    postalCode: "641009",
    country: "India",
    countryCode: "IN",
  },
  gstin: "33AADCF9341B1Z1",
  gstRegistration: "Regular taxpayer, Tamil Nadu",
  iec: "AADCF9341B",
  iecIssuer: "DGFT, Coimbatore",
  udyam: "UDYAM-TN-03-0082507",
  udyamCategory: "Micro enterprise",
  email: "hello@jakuraa.com",
  // Founder to supply the business telephone number. Rendered only when set.
  phone: null as string | null,
  // Grievance officer — founder to supply the named officer. Until then the
  // page lists the designation and the company contact email.
  grievanceOfficer: {
    name: null as string | null,
    designation: "Grievance Officer",
    email: "hello@jakuraa.com",
  },
  site: "https://jakuraa.com",
} as const;

export function registeredOfficeLine() {
  const a = company.registeredOffice;
  return `${a.street}, ${a.locality}, ${a.region} ${a.postalCode}, ${a.country}`;
}

export function legalLine() {
  return `${company.legalName} (formerly ${company.formerName}) · CIN ${company.cin} · Registered office: ${registeredOfficeLine()}`;
}

// Timeline — each entry is backed by a statutory record or verifiable repo
// history. Undated founder-stated events carry no year rather than a guess.
export const timeline: { when: string; title: string; body: string }[] = [
  {
    when: "Dec 2019",
    title: "Incorporation",
    body: "Incorporated in Coimbatore, Tamil Nadu under the Companies Act, 2013 as a private company limited by shares.",
  },
  {
    when: "2020",
    title: "Importer-Exporter Code",
    body: "Registered with the Directorate General of Foreign Trade (Coimbatore) for import and export.",
  },
  {
    when: "2022",
    title: "Udyam registration",
    body: "Registered as a micro enterprise under Udyam, covering general-purpose machinery and parts.",
  },
  {
    when: "Name change",
    title: "Falcor Commercial becomes Jakuraa Commercial",
    body: "The company changed its name from Falcor Commercial Private Limited to Jakuraa Commercial Private Limited.",
  },
  {
    when: "2026",
    title: "Satelink",
    body: "Began building Satelink, machine-commerce infrastructure where software agents pay per call and settle on-chain.",
  },
];

export const principles: { title: string; body: string }[] = [
  {
    title: "Say only what is true",
    body: "We describe what we operate, what we are registered to do, and what we plan — and we label which is which.",
  },
  {
    title: "Build for the long term",
    body: "We prefer durable infrastructure and plain records over short-term growth that we cannot stand behind.",
  },
  {
    title: "Stay accountable",
    body: "Our statutory details are published, our registered office is listed, and there is a named route for grievances.",
  },
  {
    title: "Earn trust in small steps",
    body: "New businesses start as registered capabilities and become operating businesses only when they are genuinely running.",
  },
];
