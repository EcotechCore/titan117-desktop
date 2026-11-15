import { defineConfig } from 'vitest/config'

// Phase 3's check against a real model (roadmap: "Titan finishes 10 scripted
// everyday tasks; the prompt-injection suite passes"). Needs OPENROUTER_API_KEY
// in .env and the internet; costs a few cents. Run with `pnpm eval:titan`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/live/**/*.live.ts'],
    testTimeout: 300_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    maxConcurrency: 1
  }
})
