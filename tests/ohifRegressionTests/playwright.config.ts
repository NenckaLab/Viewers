import { defineConfig } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Credentials + config come from the workspace .env (gitignored).
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '.env') });

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  timeout: 180_000, // large studies are slow today; per-step budgets are asserted inside tests
  expect: {
    timeout: 30_000,
    toHaveScreenshot: {
      // GPU/canvas rendering varies slightly across machines; run in the
      // pinned Playwright Docker image for stable baselines.
      maxDiffPixelRatio: 0.02,
    },
  },
  retries: process.env.CI ? 1 : 0,
  workers: 1, // one session at a time against a shared XNAT
  reporter: [['html', { open: 'never' }], ['list'], ['./reporters/summary-reporter.ts']],
  use: {
    baseURL: process.env.XNAT_BASE_URL || 'https://cirxnat3.cir.mcw.edu',
    storageState: 'auth-state.json',
    viewport: { width: 1600, height: 1000 },
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: true,
  },
});
