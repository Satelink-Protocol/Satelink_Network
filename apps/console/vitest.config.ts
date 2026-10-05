import { defineConfig } from "vitest/config";
import path from "node:path";

// Console unit/component tests (Stage 25). Server-render components with react-dom/server; no DOM needed.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  esbuild: { jsx: "automatic" },
  test: { include: ["test/**/*.test.{ts,tsx}"], environment: "node" },
});
