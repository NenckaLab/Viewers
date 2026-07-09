import { Page, expect } from '@playwright/test';

/** Test study — a fixed, known dataset. Override via .env to point elsewhere. */
export const TEST_STUDY = {
  projectId: process.env.OHIF_TEST_PROJECT || 'CIR_OverreadsTest',
  subjectId: process.env.OHIF_TEST_SUBJECT || 'CIRXNAT3_S00662',
  experimentId: process.env.OHIF_TEST_EXPERIMENT || 'CIRXNAT3_E00878',
  experimentLabel: process.env.OHIF_TEST_LABEL || 'MCW_0334_A',
};

/** Pinned series instance counts per experiment — update when the study changes. */
export const STUDY_SERIES_GROUND_TRUTH: Record<string, Record<string, number>> = {
  CIRXNAT3_E00878: {
    '3Plane Loc SSFSE': 36,
    T1W: 228,
    T2W: 224,
    'T2-FLAIR': 172,
  },
  XNAT_E00006: {
    'Ax SWAN': 100,
    'B AX T2 FLAIR': 23,
    '3D ASL': 72,
    'B Ax DWI ASSET': 46,
    'Sag 3D Neuroreader': 132,
    'B Ax T2': 23,
  },
};

export function viewerUrl(study = TEST_STUDY): string {
  const q = new URLSearchParams({
    subjectId: study.subjectId,
    projectId: study.projectId,
    experimentId: study.experimentId,
    experimentLabel: study.experimentLabel,
  });
  return `/VIEWER/?${q.toString()}`;
}

export interface DisplaySetInfo {
  uid: string;
  SeriesDescription: string;
  SeriesNumber: number | string | undefined;
  Modality: string;
  numImageFrames: number;
  PatientName: unknown;
  PatientID: unknown;
  StudyDate: unknown;
  StudyDescription: unknown;
}

/**
 * Wait until the viewer app has display sets registered and the series
 * browser shows at least one thumbnail. Returns elapsed ms.
 */
export async function waitForViewerReady(page: Page, timeoutMs = 120_000): Promise<number> {
  const t0 = Date.now();
  await page.waitForFunction(
    () => {
      const s = (window as any).services;
      try {
        return s && s.displaySetService.getActiveDisplaySets().length > 0;
      } catch {
        return false;
      }
    },
    undefined,
    { timeout: timeoutMs },
  );
  await expect(page.locator('[data-cy="study-browser-thumbnail"]').first()).toBeVisible({
    timeout: timeoutMs,
  });
  return Date.now() - t0;
}

/** Read display sets straight from the OHIF DisplaySetService. */
export async function getDisplaySets(page: Page): Promise<DisplaySetInfo[]> {
  return page.evaluate(() => {
    const dss = (window as any).services.displaySetService;
    return dss.getActiveDisplaySets().map((d: any) => ({
      uid: d.displaySetInstanceUID,
      SeriesDescription: d.SeriesDescription,
      SeriesNumber: d.SeriesNumber,
      Modality: d.Modality,
      numImageFrames: d.numImageFrames,
      PatientName: d.PatientName,
      PatientID: d.PatientID,
      StudyDate: d.StudyDate,
      StudyDescription: d.StudyDescription,
    }));
  });
}

/** Viewport grid state: which display sets are in which panes. */
export async function getViewportGrid(page: Page) {
  return page.evaluate(() => {
    const grid = (window as any).services.viewportGridService.getState();
    const viewports: any[] = [];
    // OHIF v3 stores viewports as a Map keyed by viewportId
    (grid.viewports as Map<string, any>).forEach((vp, id) => {
      viewports.push({ id, displaySetInstanceUIDs: vp.displaySetInstanceUIDs });
    });
    return { layout: grid.layout, activeViewportId: grid.activeViewportId, viewports };
  });
}

/**
 * VOI (window/level) per viewport, read from Cornerstone3D — exact values,
 * no screenshot guesswork.
 */
export async function getViewportVOIs(page: Page): Promise<Record<string, { lower: number; upper: number } | null>> {
  return page.evaluate(() => {
    const s = (window as any).services;
    const grid = s.viewportGridService.getState();
    const out: Record<string, any> = {};
    (grid.viewports as Map<string, any>).forEach((_vp, id) => {
      try {
        const csVp = s.cornerstoneViewportService.getCornerstoneViewport(id);
        out[id] = csVp ? (csVp.getProperties().voiRange ?? null) : null;
      } catch {
        out[id] = null;
      }
    });
    return out;
  });
}

/** Switch to an N×M layout via the toolbar Layout button. */
export async function setLayout(page: Page, rows: number, cols: number) {
  await page.locator('[data-cy="Layout"]').click();
  // The layout selector renders a grid of cells; OHIF uses data-cy like
  // "Layout-{c}-{r}" in some builds — fall back to service call if not found.
  const cell = page.locator(`[data-cy="Layout-${cols - 1}-${rows - 1}"]`);
  if (await cell.count()) {
    await cell.click();
  } else {
    await page.keyboard.press('Escape');
    await page.evaluate(
      ([r, c]) => (window as any).services.viewportGridService.setLayout({ numRows: r, numCols: c }),
      [rows, cols],
    );
  }
  await page.waitForFunction(
    ([r, c]) => {
      const l = (window as any).services.viewportGridService.getState().layout;
      return l.numRows === r && l.numCols === c;
    },
    [rows, cols],
  );
}

/**
 * Drag the nth series thumbnail onto the nth viewport pane.
 * Returns the displaySetInstanceUID of the dragged thumbnail (parsed from its
 * element id, `thumbnail-<uid>`) — thumbnail order does NOT match
 * displaySetService order, so callers must use this return value.
 */
export async function dragThumbnailToViewport(page: Page, thumbIndex: number, viewportIndex: number): Promise<string> {
  const thumb = page.locator('[data-cy="study-browser-thumbnail"]').nth(thumbIndex);
  const uid = (await thumb.getAttribute('id'))?.replace(/^thumbnail-/, '');
  if (!uid) throw new Error('thumbnail has no id attribute to derive displaySet UID from');
  const pane = page.locator('[data-cy="viewport-pane"]').nth(viewportIndex);
  await thumb.scrollIntoViewIfNeeded();
  // Manual mouse sequence: HTML5 dragTo() is unreliable with react-dnd,
  // and OHIF's series browser uses draggable thumbnails.
  const tb = await thumb.boundingBox();
  const pb = await pane.boundingBox();
  if (!tb || !pb) throw new Error('thumbnail or viewport pane not visible');
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb.x + tb.width / 2 + 10, tb.y + tb.height / 2 + 10, { steps: 5 });
  await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2, { steps: 15 });
  await page.mouse.up();
  return uid;
}

/** Adjust W/L in a viewport by dragging with the WindowLevel tool active. */
export async function adjustWindowLevel(page: Page, viewportIndex: number, dx = 120, dy = 80) {
  await page.locator('[data-cy="WindowLevel-btn"]').click();
  const pane = page.locator('[data-cy="viewport-pane"]').nth(viewportIndex);
  const pb = await pane.boundingBox();
  if (!pb) throw new Error('viewport pane not visible');
  const cx = pb.x + pb.width / 2;
  const cy = pb.y + pb.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 10 });
  await page.mouse.up();
}

/** Dismiss the "investigational use only" banner if present. */
export async function dismissInvestigationalBanner(page: Page) {
  const btn = page.locator('[data-cy="confirm-and-hide-button"]');
  if (await btn.isVisible().catch(() => false)) await btn.click();
}

/** Remove sync groups so W/L changes stay viewport-local. */
export async function disableVoiSync(page: Page) {
  await page.evaluate(() => {
    const { syncGroupService, viewportGridService, cornerstoneViewportService } = (window as any).services;
    const { viewports } = viewportGridService.getState();
    [...viewports.values()].forEach((gridViewport: any) => {
      const { viewportId } = gridViewport.viewportOptions;
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      if (!viewport) return;
      syncGroupService.getSynchronizersForViewport(viewportId).forEach((syncState: any) => {
        syncGroupService.removeViewportFromSyncGroup(
          viewport.id,
          viewport.getRenderingEngine().id,
          syncState.id,
        );
      });
    });
  });
}

/** Cornerstone VOI signature for the active viewport (fallback when overlay DOM is empty). */
export async function getActiveViewportVoiSignature(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const s = (window as any).services;
    const id = s.viewportGridService.getState().activeViewportId;
    const voi = s.cornerstoneViewportService.getCornerstoneViewport(id)?.getProperties()?.voiRange;
    return voi ? `${voi.lower}/${voi.upper}` : null;
  });
}
