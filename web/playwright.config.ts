import { defineConfig } from 'playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  workers: 2,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    browserName: 'chromium',
    channel: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'light',
    actionTimeout: 10_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
