import { defineConfig, devices } from "@playwright/test";

// Console E2E. Runs against a production build served locally, or a deployed
// preview via PW_BASE_URL. Signed-in flows need a real session and are driven
// by the task-completion script (e2e/simple-flows.spec.ts) against a preview.
const BASE_URL = process.env.PW_BASE_URL || "http://localhost:3402";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: [["list"]],
  use: { baseURL: BASE_URL },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.PW_BASE_URL
    ? undefined
    : { command: "npm run build && npx next start -p 3402", url: BASE_URL, timeout: 240_000, reuseExistingServer: true },
});
