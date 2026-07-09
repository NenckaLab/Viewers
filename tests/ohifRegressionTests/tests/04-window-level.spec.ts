import { test, expect } from '../helpers/fixtures';
import {
  viewerUrl, waitForViewerReady, dismissInvestigationalBanner,
  setLayout, dragThumbnailToViewport, adjustWindowLevel, getViewportVOIs, getViewportGrid,
  disableVoiSync,
} from '../helpers/ohif';

/**
 * Bug class 4: W/L adjustment in one viewport is incorrectly linked to a
 * different series in another viewport. VOI is read straight from
 * Cornerstone3D so the assertion is exact.
 */
test('window/level is independent across viewports with different series', async ({ page }) => {
  await page.goto(viewerUrl());
  await waitForViewerReady(page);
  await dismissInvestigationalBanner(page);

  await setLayout(page, 1, 2);
  // Put a different series in the second pane.
  await dragThumbnailToViewport(page, 1, 1);
  await expect
    .poll(async () => (await getViewportGrid(page)).viewports[1]?.displaySetInstanceUIDs?.length ?? 0)
    .toBeGreaterThan(0);

  // Wait for both viewports to have a VOI (i.e., an image displayed).
  await expect
    .poll(async () => {
      const vois = await getViewportVOIs(page);
      return Object.values(vois).filter(Boolean).length;
    }, { timeout: 60_000 })
    .toBe(2);

  await disableVoiSync(page);

  const before = await getViewportVOIs(page);
  const [idA, idB] = Object.keys(before);

  // Click into viewport A to make it active, then drag W/L there.
  await page.locator('[data-cy="viewport-pane"]').nth(0).click();
  await adjustWindowLevel(page, 0, 150, 100);

  const after = await getViewportVOIs(page);

  // Viewport A must have changed…
  expect(
    JSON.stringify(after[idA]),
    'W/L drag had no effect on the target viewport',
  ).not.toBe(JSON.stringify(before[idA]));

  // …and viewport B (different series) must NOT have changed.
  expect(
    JSON.stringify(after[idB]),
    `W/L in ${idA} leaked into ${idB} (different series)`,
  ).toBe(JSON.stringify(before[idB]));
});
