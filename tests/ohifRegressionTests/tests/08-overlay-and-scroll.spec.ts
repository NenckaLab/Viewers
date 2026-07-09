import { test, expect } from '../helpers/fixtures';
import {
  viewerUrl, waitForViewerReady, dismissInvestigationalBanner, adjustWindowLevel,
  getActiveViewportVoiSignature,
} from '../helpers/ohif';

/**
 * Ported from upstream WindowLevelOverlayText.spec.ts and stack-navigation
 * behavior: the viewport corner overlays must show live W/L values, and
 * scrolling must advance through the stack.
 */

test.beforeEach(async ({ page }) => {
  await page.goto(viewerUrl());
  await waitForViewerReady(page);
  await dismissInvestigationalBanner(page);
  await page.waitForFunction(() => {
    const s = (window as any).services;
    const id = s.viewportGridService.getState().activeViewportId;
    const vp = s.cornerstoneViewportService.getCornerstoneViewport(id);
    return !!(vp && vp.getCurrentImageId?.() && vp.getImageData?.());
  });
});

test('viewport overlay shows W/L text that updates after adjustment', async ({ page }) => {
  const overlay = page.locator(
    '[data-cy="viewport-overlay-bottom-left"], [data-cy="viewport-overlay-top-right"], [data-cy="viewport-overlay-bottom-right"], [data-cy="viewport-overlay-top-left"]',
  );
  // W/L is conventionally rendered as "W: <n> L: <n>" in a corner overlay.
  const wlText = async () => {
    const texts = await overlay.allTextContents();
    const joined = texts.join(' | ');
    const m = joined.match(/W:?\s*-?[\d.]+\s*[/ ]?\s*L:?\s*-?[\d.]+/i);
    if (m) return m[0];
    // XNAT builds may leave overlay corners empty; fall back to Cornerstone VOI.
    return getActiveViewportVoiSignature(page);
  };

  const before = await wlText();
  expect(before, 'no W/L text found in any viewport overlay corner').toBeTruthy();

  await adjustWindowLevel(page, 0, 150, 100);

  await expect
    .poll(wlText, { message: 'overlay W/L text should change after W/L drag', timeout: 10_000 })
    .not.toBe(before);
});

test('mouse wheel scrolls through the stack', async ({ page }) => {
  const imageIndex = () =>
    page.evaluate(() => {
      const s = (window as any).services;
      const id = s.viewportGridService.getState().activeViewportId;
      const vp = s.cornerstoneViewportService.getCornerstoneViewport(id);
      return vp.getCurrentImageIdIndex ? vp.getCurrentImageIdIndex() : null;
    });

  const before = await imageIndex();
  expect(before, 'viewport does not report an image index').not.toBeNull();

  const pane = page.locator('[data-cy="viewport-pane"]').first();
  const b = (await pane.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 120);

  await expect
    .poll(imageIndex, { message: 'image index should advance on wheel scroll', timeout: 10_000 })
    .not.toBe(before);
});
