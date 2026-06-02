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
  webServer: {
    command: 'npm run dev',
    port: 3000,
    reuseExistingServer: true,
    timeout: 60000,
  },
});
