import type { Metadata } from "next";
import { company } from "@/content/company";
import { LegalPage } from "@/components/LegalLayout";

export const metadata: Metadata = { title: "Terms of use", description: "Terms of use for jakuraa.com." };

export default function Terms() {
  return (
    <LegalPage title="Terms of use" current="/legal/terms">
      <p>
        jakuraa.com is operated by {company.legalName}. By using this website you agree to these terms.
      </p>
      <h2>Information only</h2>
      <p>
        This website describes the company and its businesses. It is not an offer to sell goods or services. Where a business is
        described as a &quot;registered capability&quot; or &quot;planned&quot;, it is not currently trading.
      </p>
      <h2>Satelink</h2>
      <p>Use of Satelink products is governed by the terms published at satelink.network, not by these terms.</p>
      <h2>Intellectual property</h2>
      <p>The text, illustrations and design of this website belong to {company.legalName} unless stated otherwise.</p>
      <h2>No warranty</h2>
      <p>
        We take care to keep this website accurate, but it is provided &quot;as is&quot;. To the extent permitted by law, we are
        not liable for loss arising from reliance on it.
      </p>
      <h2>Governing law</h2>
      <p>These terms are governed by the laws of India. Courts at Coimbatore, Tamil Nadu have jurisdiction.</p>
      <h2>Contact</h2>
      <p>
        Questions about these terms: <a href={`mailto:${company.email}`}>{company.email}</a>.
      </p>
    </LegalPage>
  );
}
