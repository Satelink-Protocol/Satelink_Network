import { defineConfig } from "vitest/config";

// Standalone config — apps/cms is isolated from the workspace (React 19), so it
// does NOT use the root vitest projects. Run: `npx vitest run --config vitest.config.ts`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
