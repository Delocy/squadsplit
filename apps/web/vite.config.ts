import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// React Router's ESM build, for tests. From Node 22.12, its "module-sync" export condition lets Node load
// `react-router` as ESM while `react-router/dom` still resolves to the CommonJS build, which brings its own copy of
// the router contexts: <RouterProvider> from one copy, <ScrollRestoration> from the other, and the router is
// "missing". Pointing both entries at the ESM files (which share one chunk) gives tests a single React Router on
// every Node version. The browser bundle is unaffected: Vite already picks the ESM build there.
const reactRouter = dirname(createRequire(import.meta.url).resolve('react-router/package.json'))
const reactRouterEsm = (file: string) => join(reactRouter, 'dist/development', file)

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    alias: [
      { find: /^react-router$/, replacement: reactRouterEsm('index.mjs') },
      { find: /^react-router\/dom$/, replacement: reactRouterEsm('dom-export.mjs') },
    ],
    // Fixed, so tests never depend on a developer's .env.local.
    env: { VITE_API_URL: 'http://localhost:8787' },
  },
})
