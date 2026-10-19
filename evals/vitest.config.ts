import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Separate from the root vitest.config.ts on purpose: the product suite
// (`npm test` -> `vitest run`) includes only `tests/**/*.test.ts`, so nothing
// here can slow, fail or hang the default run. Evals use `*.eval.ts`.
export default defineConfig({
  resolve: {
    alias: {
      '#shared': fileURLToPath(new URL('../shared', import.meta.url)),
      '~~': fileURLToPath(new URL('..', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    root: fileURLToPath(new URL('..', import.meta.url)),
    include: ['evals/**/*.eval.ts'],
    // A live goal plan can take 30s per call; the offline path ignores this.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
})
