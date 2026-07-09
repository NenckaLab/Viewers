import { test, expect } from '../helpers/fixtures';
import { viewerUrl, waitForViewerReady, dismissInvestigationalBanner } from '../helpers/ohif';

/**
 * Ported from upstream Invert / FlipHorizontal / RotateRight / Reset specs.
 * Upstream asserts golden screenshots; we assert the exact Cornerstone3D
 * viewport properties/camera, which is deterministic across machines.
 */

async function getViewportProps(page: any) {
  return page.evaluate(() => {
    const s = (window as any).services;
    const id = s.viewportGridService.getState().activeViewportId;
    const vp = s.cornerstoneViewportService.getCornerstoneViewport(id);
    const props = vp.getProperties();
    const cam = vp.getCamera();
    return {
      invert: !!props.invert,
      rotation: props.rotation ?? vp.getViewPresentation?.()?.rotation ?? 0,
      flipHorizontal: !!cam.flipHorizontal,
      zoom: vp.getZoom ? vp.getZoom() : null,
      voiRange: props.voiRange ?? null,
    };
  });
}

async function runCommand(page: any, command: string, options: any = {}) {
  // Toolbar placement of these tools varies (MoreTools split button);
  // invoking commandsManager directly tests the same code path the
  // toolbar buttons call, without depending on menu DOM structure.
  await page.evaluate(
    ([cmd, opts]: any) => (window as any).commandsManager
      ? (window as any).commandsManager.runCommand(cmd, opts)
      : Promise.reject('no commandsManager'),
    [command, options],
  );
}

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

test('invert / flip / rotate mutate viewport state', async ({ page }) => {
  const hasCommands = await page.evaluate(() => !!(window as any).commandsManager);
  test.skip(!hasCommands, 'window.commandsManager not exposed in this build — use toolbar menu instead');

  const initial = await getViewportProps(page);

  await runCommand(page, 'invertViewport');
  expect((await getViewportProps(page)).invert).toBe(!initial.invert);
  await runCommand(page, 'invertViewport');
  expect((await getViewportProps(page)).invert).toBe(initial.invert);

  await runCommand(page, 'flipViewportHorizontal');
  expect((await getViewportProps(page)).flipHorizontal).toBe(!initial.flipHorizontal);
  await runCommand(page, 'flipViewportHorizontal');
  expect((await getViewportProps(page)).flipHorizontal).toBe(initial.flipHorizontal);

  await runCommand(page, 'rotateViewportCW');
  const rotated = await getViewportProps(page);
  expect(Math.abs(((rotated.rotation - initial.rotation) + 360) % 360)).toBe(90);
});

test('zoom tool changes zoom and Reset restores it', async ({ page }) => {
  const initial = await getViewportProps(page);

  await page.locator('[data-cy="Zoom-btn"]').click();
  const pane = page.locator('[data-cy="viewport-pane"]').first();
  const b = (await pane.boundingBox())!;
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 150, { steps: 10 });
  await page.mouse.up();

  const zoomed = await getViewportProps(page);
  expect(zoomed.zoom, 'zoom drag should change zoom level').not.toBe(initial.zoom);

  await page.locator('[data-cy="Reset-btn"]').click();
  await expect
    .poll(async () => (await getViewportProps(page)).zoom, { timeout: 10_000 })
    .toBeCloseTo(initial.zoom!, 2);
});
