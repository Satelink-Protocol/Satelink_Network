import { defineConfig, devices } from "@playwright/test";

// E2E config for the reposition (§9). Runs against a production build served
// locally. Set PW_BASE_URL to test a deployed preview instead (then no local
// server is started). Browsers: `npx playwright install chromium`.
const BASE_URL = process.env.PW_BASE_URL || "http://localhost:3100";
const useLocalServer = !process.env.PW_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: useLocalServer
    ? {
        // Build then serve so NEXT_PUBLIC_* (inlined at build time) are present.
        // The checkout gate reads NEXT_PUBLIC_DODO_CREDIT_PACKS to decide it is
        // "configured"; a test pack keeps the flow enabled without real Dodo
        // credentials (the network call itself is mocked in the specs).
        command: "npm run build && npm run start -- -p 3100",
        url: BASE_URL,
        timeout: 240_000,
        reuseExistingServer: !process.env.CI,
        env: {
          NEXT_PUBLIC_DODO_CREDIT_PACKS: "pdt_e2e_starter:9.99:Starter Pack",
          NEXT_PUBLIC_SITE_URL: "http://localhost:3100",
        },
      }
    : undefined,
});
