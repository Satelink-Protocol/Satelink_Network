import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
    resolve: {
        // Mirrors tsconfig.json's "@/*" -> "./src/*" — Next.js resolves this
        // natively at build time, but vitest needs it spelled out explicitly.
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    test: {
        environment: 'node',
        globals: true,
        // Playwright specs under e2e/ use their own runner (`npm run e2e`).
        // Keep vitest from collecting them — they call Playwright's test().
        exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    },
})
