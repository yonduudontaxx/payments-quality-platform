import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  timeout: 30000,
  // Serial execution required: simulation config is in-process state shared
  // across all workers. Parallel workers racing on config produce flaky tests.
  workers: 1,
  reporter: [
    ['list'],
    ['allure-playwright', { resultsDir: 'allure-results/playwright' }],
  ],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:3000',
  },
  // Skip webServer when BASE_URL is set — caller is responsible for the server.
  // Without BASE_URL, Playwright starts the payments dev server on port 3000.
  webServer: process.env.BASE_URL ? undefined : {
    command: 'npm run dev',
    port: 3000,
    timeout: 60000,
  },
});
