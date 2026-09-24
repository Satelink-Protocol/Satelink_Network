import type { Metadata } from "next";
import { company } from "@/content/company";
import { LegalPage } from "@/components/LegalLayout";

export const metadata: Metadata = { title: "Privacy", description: "Privacy notice for jakuraa.com." };

export default function Privacy() {
  return (
    <LegalPage title="Privacy notice" current="/legal/privacy">
      <p>
        This notice explains how {company.legalName} (&quot;Jakuraa&quot;, &quot;we&quot;) handles personal data collected through
        jakuraa.com. It is written with the Digital Personal Data Protection Act, 2023 in mind. Satelink, our technology
        business, publishes its own privacy information at satelink.network.
      </p>
      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Enquiries.</strong> If you use the contact form or email us, we receive your name, email address, optional
          organisation, the topic you choose and your message.
        </li>
        <li>
          <strong>Technical data.</strong> Our hosting provider processes the IP address and request details your browser sends,
          for security and to serve the site. This site does not use advertising or analytics cookies.
        </li>
      </ul>
      <h2>Why we use it</h2>
      <p>
        We use enquiry data only to reply to you and to keep a record of the correspondence. We do not sell personal data or use
        it for advertising.
      </p>
      <h2>Who processes it for us</h2>
      <ul>
        <li>Vercel Inc. — website hosting.</li>
        <li>Resend — delivery of the enquiry email and your confirmation email.</li>
      </ul>
      <h2>How long we keep it</h2>
      <p>We keep enquiry correspondence for as long as needed to deal with it and to meet legal obligations, then delete it.</p>
      <h2>Your rights</h2>
      <p>
        You may ask to access, correct or erase your personal data, withdraw consent, or nominate another person to exercise your
        rights. Write to <a href={`mailto:${company.email}`}>{company.email}</a>. If you are not satisfied with our response, you
        may contact our <a href="/legal/grievance">grievance officer</a>, and you have the right to approach the Data Protection
        Board of India.
      </p>
    </LegalPage>
  );
}
