import { defineConfig } from '@playwright/test'

// T-04: end-to-end tests against the built binary and a temp root.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    viewport: { width: 1400, height: 900 },
    trace: 'retain-on-failure',
  },
})
