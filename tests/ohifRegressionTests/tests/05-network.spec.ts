import { test, expect } from '../helpers/fixtures';
import { viewerUrl, waitForViewerReady } from '../helpers/ohif';

/**
 * Performance regressions with a diagnosis attached: assert on the *shape*
 * of network traffic during study load, not just wall-clock time.
 * Observed 2026-07-09: the viewer downloads one full .dcm per scan during
 * metadata load (~100 requests for this study). If that pattern degrades to
 * per-instance fetches, this catches it immediately.
 */
test('study load request count and failures within budget', async ({ page }, testInfo) => {
  const dicomRequests: string[] = [];
  const failures: string[] = [];

  page.on('request', (req) => {
    if (req.url().includes('/resources/DICOM/files/')) dicomRequests.push(req.url());
  });
  page.on('response', (res) => {
    if (res.status() < 400) return;
    const url = res.url();
    // Optional hanging-protocol files may not exist on local/dev XNAT.
    if (res.status() === 404 && url.includes('/hanging-protocols/')) return;
    failures.push(`${res.status()} ${url}`);
  });

  await page.goto(viewerUrl());
  await waitForViewerReady(page);
  await page.waitForTimeout(5_000); // let trailing metadata requests settle

  await testInfo.attach('network-summary', {
    body: JSON.stringify({ dicomRequestCount: dicomRequests.length, failures }, null, 2),
    contentType: 'application/json',
  });

  expect(failures, `HTTP failures during load:\n${failures.join('\n')}`).toEqual([]);
  // ~1 metadata fetch per scan today (~100). Fail if it explodes toward
  // per-instance fetching (this study has ~100k instances).
  expect(dicomRequests.length, 'DICOM file requests during metadata load').toBeLessThan(300);
});
