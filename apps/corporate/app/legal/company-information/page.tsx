import type { Metadata } from "next";
import { company, registeredOfficeLine } from "@/content/company";
import { LegalPage } from "@/components/LegalLayout";
import { DefinitionList } from "@/components/Page";

export const metadata: Metadata = {
  title: "Company information",
  description: `Statutory information for ${company.legalName} (formerly ${company.formerName}), CIN ${company.cin}.`,
};

export default function CompanyInformation() {
  const g = company.grievanceOfficer;
  return (
    <LegalPage title="Company information" current="/legal/company-information">
      <p>
        This information is published in accordance with Rule 26 of the Companies (Incorporation) Rules, 2014 and section 12 of
        the Companies Act, 2013.
      </p>
      <div className="not-prose pt-4 text-base">
        <DefinitionList
          rows={[
            ["Legal name", company.legalName],
            ["Former name", company.formerName],
            ["Corporate Identity Number (CIN)", company.cin],
            ["Date of incorporation", company.incorporatedDisplay],
            ["Company type", company.companyType],
            ["Registered office", registeredOfficeLine()],
            ["GSTIN", `${company.gstin} (${company.gstRegistration})`],
            ["Importer-Exporter Code", `${company.iec} (${company.iecIssuer})`],
            ["Udyam registration", `${company.udyam} (${company.udyamCategory})`],
            ["Email", <a key="e" href={`mailto:${company.email}`} className="link-u">{company.email}</a>],
            ...(company.phone ? ([["Telephone", company.phone]] as [string, string][]) : []),
            ["Grievance officer", `${g.name ? `${g.name}, ` : ""}${g.designation} — ${g.email}`],
          ]}
        />
      </div>
      <h2>Change of name</h2>
      <p>
        The company was incorporated as {company.formerName} and subsequently changed its name to {company.legalName}. The
        Corporate Identity Number is unchanged. Documents issued before the change of name may show the former name.
      </p>
    </LegalPage>
  );
}
