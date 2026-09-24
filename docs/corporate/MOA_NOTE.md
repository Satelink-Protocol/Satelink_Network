# Note for the founder — MOA objects and name-change follow-ups

_Prepared 2026-09-24. Not legal advice; confirm with the company secretary / CA._

## 1. Satelink rests on an ancillary MOA object
Jakuraa's **main object (MOA 3(a))** is wholesale and retail trade. Satelink's software/SaaS
business relies on **MOA 3(b)(6)** — "develop, publish and license software and websites" —
which sits among the objects *incidental or ancillary* to the main object.

Payment processors (Dodo), banks and KYC reviewers often read the main-objects clause to
decide whether a merchant's business is "in scope". A software/SaaS merchant whose main
object is trading can trigger extra questions or a rejection.

**Recommended:** alter the MOA to add *information technology, software development,
software-as-a-service and related services* as a **main object**:
- Board meeting → approve the proposal and call a general meeting (or use postal ballot where applicable).
- **Special resolution** under section 13 of the Companies Act, 2013.
- File **Form MGT-14** with the RoC within 30 days of the resolution (attach the altered MOA).
- Where the company has not commenced a new main-object business, consider section 13(8)/(9) conditions if relevant.

## 2. Name change — update every registration to the new name
Dodo (and most KYC) compare the **legal name across documents**. Each of these must show
**Jakuraa Commercial Private Limited** (or be accompanied by the fresh Certificate of
Incorporation pursuant to change of name):

| Record | Where to update | Status |
|---|---|---|
| Certificate of Incorporation (name change) | MCA — issued on INC-24 approval | founder to confirm on file |
| PAN | NSDL/Protean — PAN change request with new COI | ☐ |
| GST (GSTIN 33AADCF9341B1Z1) | GST portal — non-core amendment, legal name | ☐ |
| IEC (AADCF9341B) | DGFT portal — IEC modification | ☐ |
| Udyam (UDYAM-TN-03-0082507) | Udyam portal — update details | ☐ |
| Bank account | Branch — board resolution + new COI | ☐ |

## 3. What the websites already do
- jakuraa.com shows "Jakuraa Commercial Private Limited (formerly Falcor Commercial Private
  Limited)" on /company, /contact, /legal/company-information and the footer, so reviewers
  can match older documents.
- No statutory certificate images are published, edited or re-rendered.
- Directors appear on /company/leadership **only** after the founder sets `published: true`
  in `apps/corporate/content/people.ts` with the person's consent (all hidden by default).
- The Trading & Distribution page makes **no** medicines/pharma claim. To add it, put the
  drug-licence numbers in `drugLicence` in `apps/corporate/content/businesses.ts`.

## 4. Founder inputs still needed for the site
- Business telephone number → `company.phone` (Rule 26 disclosure).
- Named grievance officer → `company.grievanceOfficer.name`.
- A working `hello@jakuraa.com` inbox (or change `company.email`).
- `RESEND_API_KEY` on the `jakuraa-corporate` Vercel project to turn on the contact form
  (without it the form tells visitors to email directly — it never pretends to send).
