import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  timeout: 30000,
  // Serial execution required: simulation config is in-process state shared
  // across all workers. Parallel workers racing on config produce flaky tests.
  workers: 1,
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
  },
});
