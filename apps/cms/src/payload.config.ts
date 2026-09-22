// Satelink CMS — Payload 3 config (§13). Postgres adapter (satelink_cms),
// Lexical richtext, Vercel Blob media, RBAC, 2FA, audit log, workflow, scheduled
// publish, on-publish revalidation. Admin is private + noindexed.
import path from "path";
import { fileURLToPath } from "url";
import { buildConfig } from "payload";
import { postgresAdapter } from "@payloadcms/db-postgres";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import { vercelBlobStorage } from "@payloadcms/storage-vercel-blob";
import sharp from "sharp";

import { collections } from "./collections";
import { globals } from "./globals";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

export default buildConfig({
  serverURL: process.env.PAYLOAD_PUBLIC_SERVER_URL || "http://localhost:3200",
  admin: {
    user: "users",
    meta: {
      titleSuffix: "· Satelink CMS",
      // Admin is never indexed (§2). Deployment protection is set in Vercel.
      robots: "noindex, nofollow",
    },
  },
  editor: lexicalEditor(),
  collections,
  globals,
  sharp,
  secret: process.env.PAYLOAD_SECRET || "",
  typescript: { outputFile: path.resolve(dirname, "payload-types.ts") },
  db: postgresAdapter({
    pool: { connectionString: process.env.DATABASE_URI || "" },
    // Never touch the production app DB — this points at satelink_cms only.
  }),
  plugins: [
    ...(process.env.BLOB_READ_WRITE_TOKEN
      ? [
          vercelBlobStorage({
            collections: { media: true },
            token: process.env.BLOB_READ_WRITE_TOKEN,
          }),
        ]
      : []),
  ],
  // Scheduled publish is handled by Payload's schedulePublish + a Vercel Cron
  // that invokes the jobs queue (see README). Login rate limit + 2FA are on the
  // Users collection auth config.
});
