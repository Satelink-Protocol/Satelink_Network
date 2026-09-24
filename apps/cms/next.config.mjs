import { withPayload } from "@payloadcms/next/withPayload";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Payload runs inside this Next app. Admin is private + noindexed via
  // middleware/headers and Vercel deployment protection (see INFRA_SETUP.md).
  reactStrictMode: true,
};

export default withPayload(nextConfig);
