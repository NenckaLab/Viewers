import { test as base, expect } from '@playwright/test';

/**
 * Extended test that records console errors and page crashes on every test.
 * Any uncaught error fails the test — this alone catches a large share of
 * regressions for free.
 *
 * Known-benign patterns can be added to IGNORED below (keep this list short
 * and reviewed; every entry is a bug you've decided to tolerate).
 */
const IGNORED: RegExp[] = [
  /Automatic fallback to software WebGL/i,
  /protocol with id .* already exists/i,
  /has already been registered/i,
  /findMatchByStudy no matching rules/i,
  // Favicon, manifest, and other optional assets missing on local/dev XNAT.
  /Failed to load resource: the server responded with a status of 404/i,
  // Occasional thumbnail fetch failures on local XNAT (full series still loads).
  /Failed to load resource: the server responded with a status of 500/i,
  /XNAT: Failed to get thumbnail src/i,
];

export interface ConsoleCapture {
  errors: string[];
  warnings: string[];
}

export const test = base.extend<{ consoleCapture: ConsoleCapture }>({
  consoleCapture: [
    async ({ page }, use) => {
      const cap: ConsoleCapture = { errors: [], warnings: [] };
      page.on('console', (msg) => {
        const text = msg.text();
        if (IGNORED.some((re) => re.test(text))) return;
        if (msg.type() === 'error') cap.errors.push(text);
        if (msg.type() === 'warning') cap.warnings.push(text);
      });
      page.on('pageerror', (err) => cap.errors.push(`pageerror: ${err.message}`));
      await use(cap);
      expect(cap.errors, `Console errors during test:\n${cap.errors.join('\n')}`).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
