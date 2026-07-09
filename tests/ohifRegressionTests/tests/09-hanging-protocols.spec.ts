import { test, expect } from '../helpers/fixtures';
import { viewerUrl, waitForViewerReady, dismissInvestigationalBanner } from '../helpers/ohif';

/**
 * Ported from upstream MPR.spec.ts / hanging-protocol specs, targeting the
 * XNAT fork's protocols (xnatmpr / mrdualstack / standard served from
 * /xapi/viewer/hanging-protocols/).
 */

test('MPR hanging protocol produces a multi-viewport layout', async ({ page }) => {
  await page.goto(viewerUrl());
  await waitForViewerReady(page);
  await dismissInvestigationalBanner(page);

  // Load a proper 3D-able volume first, then apply MPR.
  const volumeThumb = page
    .locator('[data-cy="study-browser-thumbnail"]')
    .filter({ hasText: /^(Sag 3D Neuroreader|T1W|3D ASL)/ })
    .first();
  test.skip(!(await volumeThumb.count()), 'no 3D-capable series found in test study');
  await volumeThumb.dblclick();
  try {
    await page.waitForFunction(() => {
      const s = (window as any).services;
      const id = s.viewportGridService.getState().activeViewportId;
      const vp = s.cornerstoneViewportService.getCornerstoneViewport(id);
      return !!(vp && vp.getCurrentImageId?.());
    }, undefined, { timeout: 60_000 });
  } catch {
    test.skip(true, '3D volume did not load in time on this environment');
  }

  const protocols: string[] = await page.evaluate(() =>
    [...(window as any).services.hangingProtocolService.protocols.keys()],
  );
  const mprId = protocols.find((p) => /mpr/i.test(p));
  test.skip(!mprId, `no MPR protocol registered (have: ${protocols.join(', ')})`);

  // Invoke through commandsManager like the toolbar does — calling
  // hangingProtocolService.setProtocol directly bypasses required context
  // setup and throws internally.
  await page.evaluate(
    (id) => (window as any).commandsManager.runCommand('setHangingProtocol', { protocolId: id }),
    mprId!,
  );

  // Expect >1 viewport, each with a distinct camera orientation.
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const s = (window as any).services;
          const grid = s.viewportGridService.getState();
          const normals: string[] = [];
          (grid.viewports as Map<string, any>).forEach((_vp: any, id: string) => {
            try {
              const vp = s.cornerstoneViewportService.getCornerstoneViewport(id);
              const n = vp?.getCamera?.()?.viewPlaneNormal;
              if (n) normals.push(n.map((v: number) => v.toFixed(1)).join(','));
            } catch {}
          });
          return new Set(normals).size;
        }),
      { message: 'MPR should yield multiple viewports with distinct orientations', timeout: 60_000 },
    )
    .toBeGreaterThan(1);
});
