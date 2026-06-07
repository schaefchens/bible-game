import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const pkg = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// Internal @bible/* packages ship TypeScript source; alias them so Vite transpiles them as app
// source (rather than serving raw .ts from a node_modules symlink).
// The production build is served under "/game/" (override via VITE_BASE); the dev server stays at "/".
export default defineConfig(({ command }) => ({
  base: process.env.VITE_BASE ?? (command === 'build' ? '/game/' : '/'),
  plugins: [react()],
  resolve: {
    alias: {
      '@bible/engine': pkg('../../packages/engine/src/index.ts'),
      '@bible/content': pkg('../../packages/content/src/index.ts'),
      '@bible/i18n': pkg('../../packages/i18n/src/index.ts'),
      '@bible/persistence': pkg('../../packages/persistence/src/index.ts'),
      '@bible/assets': pkg('../../packages/assets/src/index.ts'),
    },
  },
  server: { port: 5173 },
}))
