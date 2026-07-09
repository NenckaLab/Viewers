import { test, expect } from '../helpers/fixtures';
import { viewerUrl, waitForViewerReady, dismissInvestigationalBanner } from '../helpers/ohif';

/**
 * Bug class 1: slow load.
 * Budgets are asserted per phase and the raw numbers are attached to the
 * report so trends are visible before hard failures.
 */
test('viewer loads test study within budget', async ({ page }, testInfo) => {
  const t0 = Date.now();
  await page.goto(viewerUrl());

  // Phase 1: app shell interactive (toolbar rendered)
  await expect(page.locator('[data-cy="Layout"]')).toBeVisible({ timeout: 30_000 });
  const shellMs = Date.now() - t0;

  // Phase 2: study metadata loaded (display sets registered + thumbnails)
  const readyMs = shellMs + (await waitForViewerReady(page));
  await dismissInvestigationalBanner(page);

  // Phase 3: first image actually loaded into a Cornerstone viewport.
  // (Reading canvas pixels is unreliable: WebGL buffers are cleared after
  // compositing unless preserveDrawingBuffer is set.)
  await page.waitForFunction(
    () => {
      const s = (window as any).services;
      const grid = s.viewportGridService.getState();
      let loaded = false;
      (grid.viewports as Map<string, any>).forEach((_vp: any, id: string) => {
        try {
          const csVp = s.cornerstoneViewportService.getCornerstoneViewport(id);
          if (csVp && csVp.getCurrentImageId?.() && csVp.getImageData?.()) loaded = true;
        } catch {}
      });
      return loaded;
    },
    undefined,
    { timeout: 120_000 },
  );
  const renderedMs = Date.now() - t0;

  await testInfo.attach('timings', {
    body: JSON.stringify({ shellMs, readyMs, renderedMs }, null, 2),
    contentType: 'application/json',
  });
  console.log(`load timings: shell=${shellMs}ms ready=${readyMs}ms rendered=${renderedMs}ms`);

  // Budgets — tune to your infrastructure, then tighten as fixes land.
  expect(shellMs, 'app shell interactive').toBeLessThan(15_000);
  expect(readyMs, 'study metadata loaded').toBeLessThan(60_000);
  expect(renderedMs, 'first image rendered').toBeLessThan(90_000);
});
