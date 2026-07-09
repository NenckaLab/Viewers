import { test, expect } from '../helpers/fixtures';
import {
  viewerUrl, waitForViewerReady, getDisplaySets, dismissInvestigationalBanner, TEST_STUDY,
  STUDY_SERIES_GROUND_TRUTH,
} from '../helpers/ohif';

/**
 * Bug class 3: exam details listed as "Unknown".
 * Confirmed live 2026-07-09: PatientName/PatientID/StudyDate are undefined on
 * every display set, SeriesNumber is 0/blank everywhere, and the header shows
 * "Multiple Patients" for a single-subject URL.
 */
test.beforeEach(async ({ page }) => {
  await page.goto(viewerUrl());
  await waitForViewerReady(page);
  await dismissInvestigationalBanner(page);
});

test('no "Unknown" text in study browser or header', async ({ page }) => {
  const panel = page.locator('[data-cy="studyBrowser-panel"]');
  await expect(panel).not.toContainText(/unknown/i);
  await expect(page.locator('header, [class*="header"]').first()).not.toContainText(/multiple patients/i);
});

test('display sets carry patient/study metadata', async ({ page }) => {
  const displaySets = await getDisplaySets(page);
  expect(displaySets.length).toBeGreaterThan(0);

  for (const ds of displaySets) {
    expect.soft(ds.PatientName, `PatientName missing on "${ds.SeriesDescription}"`).toBeTruthy();
    expect.soft(ds.PatientID, `PatientID missing on "${ds.SeriesDescription}"`).toBeTruthy();
    expect.soft(ds.StudyDate, `StudyDate missing on "${ds.SeriesDescription}"`).toBeTruthy();
  }
});

test('series numbers are populated and unique-ish', async ({ page }) => {
  const displaySets = await getDisplaySets(page);
  const numbers = displaySets.map((d) => Number(d.SeriesNumber));

  for (const ds of displaySets) {
    expect.soft(
      Number(ds.SeriesNumber),
      `SeriesNumber missing/zero on "${ds.SeriesDescription}"`,
    ).toBeGreaterThan(0);
  }
  // If every series claims the same number, mapping is broken even if nonzero.
  expect(new Set(numbers).size, 'all series share one SeriesNumber').toBeGreaterThan(1);
});

const expectedSeries = STUDY_SERIES_GROUND_TRUTH[TEST_STUDY.experimentId];
test.describe('expected series are present with expected instance counts', () => {
  test.skip(!expectedSeries, `counts not pinned for ${TEST_STUDY.experimentId}`);

  test('matches ground truth', async ({ page }) => {
    const displaySets = await getDisplaySets(page);
    for (const [desc, count] of Object.entries(expectedSeries!)) {
      const ds = displaySets.find((d) => d.SeriesDescription === desc);
      expect(ds, `series "${desc}" missing from study browser`).toBeTruthy();
      expect(ds!.numImageFrames, `instance count for "${desc}"`).toBe(count);
    }
  });
});
