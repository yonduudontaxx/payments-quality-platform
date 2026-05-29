import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  timeout: 30000,
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
  },
});
