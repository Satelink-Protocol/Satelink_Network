import type { Metadata } from "next";
import { company, registeredOfficeLine } from "@/content/company";
import { LegalPage } from "@/components/LegalLayout";

export const metadata: Metadata = { title: "Grievance officer", description: "How to raise a grievance with Jakuraa." };

export default function Grievance() {
  const g = company.grievanceOfficer;
  return (
    <LegalPage title="Grievance officer" current="/legal/grievance">
      <p>
        If you have a complaint about this website, our handling of your personal data, or any of our businesses, you can
        write to our grievance officer.
      </p>
      <h2>Contact</h2>
      <ul>
        {g.name && <li>Name: {g.name}</li>}
        <li>Designation: {g.designation}, {company.legalName}</li>
        <li>
          Email: <a href={`mailto:${g.email}?subject=Grievance`}>{g.email}</a> (subject: &quot;Grievance&quot;)
        </li>
        <li>Post: {registeredOfficeLine()}</li>
      </ul>
      <h2>What to include</h2>
      <p>Your name, how to contact you, a description of the issue, and any reference numbers or dates that help us find it.</p>
      <h2>What happens next</h2>
      <p>
        We acknowledge grievances and aim to resolve them promptly, within the timelines required by applicable law. The
        contact form on our <a href="/contact">contact page</a> can also be used — choose the topic &quot;Grievance&quot;.
      </p>
    </LegalPage>
  );
}
