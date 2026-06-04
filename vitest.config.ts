import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const pkg = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@bible/engine': pkg('./packages/engine/src/index.ts'),
      '@bible/content': pkg('./packages/content/src/index.ts'),
      '@bible/i18n': pkg('./packages/i18n/src/index.ts'),
      '@bible/persistence': pkg('./packages/persistence/src/index.ts'),
      '@bible/assets': pkg('./packages/assets/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.{ts,tsx}', 'apps/*/src/**/*.test.{ts,tsx}'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['packages/engine/src/**'],
      exclude: ['**/*.test.ts', '**/index.ts', '**/*.d.ts'],
      reporter: ['text', 'html'],
      thresholds: {
        // Engine pillars must be exhaustively covered (raised as modules land).
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
})
