import { test, expect } from '../helpers/fixtures';
import { viewerUrl, waitForViewerReady, dismissInvestigationalBanner } from '../helpers/ohif';

/**
 * Ported from upstream OHIF tests/Length.spec.ts, Bidirectional.spec.ts,
 * MeasurementPanel.spec.ts — same interactions, but asserted against
 * measurementService state instead of upstream's golden screenshots
 * (which are pinned to their demo studies).
 */

async function viewportPoint(page: any, fx: number, fy: number) {
  const pane = page.locator('[data-cy="viewport-pane"]').first();
  const b = await pane.boundingBox();
  if (!b) throw new Error('viewport pane not visible');
  return { x: b.x + b.width * fx, y: b.y + b.height * fy };
}

async function confirmTrackingIfPrompted(page: any) {
  // The tracked-measurements workflow may prompt "Track measurements?"
  const yes = page.getByRole('button', { name: /^(yes|track|confirm)/i }).first();
  if (await yes.isVisible().catch(() => false)) await yes.click();
}

async function getMeasurements(page: any) {
  return page.evaluate(() =>
    ((window as any).services.measurementService.getMeasurements() || []).map((m: any) => ({
      uid: m.uid,
      toolName: m.toolName,
      label: m.label,
      displayText: m.displayText,
    })),
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto(viewerUrl());
  await waitForViewerReady(page);
  await dismissInvestigationalBanner(page);
  // Wait for an image to be up before drawing on it.
  await page.waitForFunction(() => {
    const s = (window as any).services;
    const id = s.viewportGridService.getState().activeViewportId;
    const vp = s.cornerstoneViewportService.getCornerstoneViewport(id);
    return !!(vp && vp.getCurrentImageId?.());
  });
});

test('length measurement is created and tracked', async ({ page }) => {
  await page.locator('[data-cy="MeasurementTools-split-button-primary"]').click();

  const p1 = await viewportPoint(page, 0.4, 0.45);
  const p2 = await viewportPoint(page, 0.6, 0.45);
  await page.mouse.click(p1.x, p1.y);
  await confirmTrackingIfPrompted(page);
  await page.mouse.click(p2.x, p2.y);
  await confirmTrackingIfPrompted(page);

  await expect
    .poll(async () => (await getMeasurements(page)).length, {
      message: 'measurementService should contain the new length measurement',
      timeout: 15_000,
    })
    .toBeGreaterThan(0);

  const [m] = await getMeasurements(page);
  expect(m.toolName).toMatch(/length/i);
});

test('measurement is removed when deleted', async ({ page }) => {
  await page.locator('[data-cy="MeasurementTools-split-button-primary"]').click();
  const p1 = await viewportPoint(page, 0.35, 0.5);
  const p2 = await viewportPoint(page, 0.55, 0.55);
  await page.mouse.click(p1.x, p1.y);
  await confirmTrackingIfPrompted(page);
  await page.mouse.click(p2.x, p2.y);
  await confirmTrackingIfPrompted(page);
  await expect.poll(async () => (await getMeasurements(page)).length).toBeGreaterThan(0);

  await page.evaluate(() => {
    const ms = (window as any).services.measurementService;
    for (const m of ms.getMeasurements()) ms.remove(m.uid);
  });
  expect((await getMeasurements(page)).length).toBe(0);
});
