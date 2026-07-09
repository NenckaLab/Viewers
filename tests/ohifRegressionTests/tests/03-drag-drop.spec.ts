import { test, expect } from '../helpers/fixtures';
import {
  viewerUrl, waitForViewerReady, dismissInvestigationalBanner,
  setLayout, dragThumbnailToViewport, getViewportGrid,
} from '../helpers/ohif';

/**
 * Bug class 2: drag/drop from the series selector to view panes does nothing.
 * Asserted against the viewport grid service (source of truth), not pixels.
 */
test('drag series thumbnail into second viewport loads that series', async ({ page }) => {
  await page.goto(viewerUrl());
  await waitForViewerReady(page);
  await dismissInvestigationalBanner(page);

  await setLayout(page, 1, 2);
  // Drag the first thumbnail (a small, fast-loading series in the pinned study).
  const targetUid = await dragThumbnailToViewport(page, 0, 1);

  await expect
    .poll(async () => {
      const grid = await getViewportGrid(page);
      return grid.viewports[1]?.displaySetInstanceUIDs ?? [];
    }, { message: 'second viewport should contain the dragged display set', timeout: 30_000 })
    .toContain(targetUid);
});

test('double-clicking a thumbnail loads it in the active viewport', async ({ page }) => {
  // Companion path: if drag/drop breaks, does the alternate route still work?
  await page.goto(viewerUrl());
  await waitForViewerReady(page);
  await dismissInvestigationalBanner(page);

  const thumb = page.locator('[data-cy="study-browser-thumbnail"]').nth(1);
  const targetUid = (await thumb.getAttribute('id'))!.replace(/^thumbnail-/, '');
  await thumb.dblclick();

  await expect
    .poll(async () => {
      const grid = await getViewportGrid(page);
      const active = grid.viewports.find((v: any) => v.id === grid.activeViewportId);
      return active?.displaySetInstanceUIDs ?? [];
    }, { timeout: 30_000 })
    .toContain(targetUid);
});
