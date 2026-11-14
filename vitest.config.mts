import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The first ESLint run in the lint-rule tests is slow on a busy machine.
    testTimeout: 30_000
  }
})
