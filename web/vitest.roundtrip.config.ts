import { defineConfig } from 'vitest/config'

// D-05, T-06: the round-trip corpus, run over ~/code and reported, not part
// of the normal test run.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['scripts/roundtrip.test.ts'],
    testTimeout: 600_000,
  },
})
