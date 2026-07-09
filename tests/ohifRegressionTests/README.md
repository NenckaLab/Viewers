# OHIF/XNAT Viewer Regression Tests

Playwright end-to-end regression suite for the XNAT-integrated OHIF v3 viewer at
`https://cirxnat3.cir.mcw.edu/VIEWER/`.

## What it covers

| Spec | Bug class |
|---|---|
| `01-load.spec.ts` | Load-time budgets per phase (shell / metadata / first rendered image); also catches blank-viewport regressions via canvas pixel sampling |
| `02-metadata.spec.ts` | "Unknown" exam details, missing PatientName/PatientID/StudyDate, blank/zero SeriesNumbers, pinned series + instance counts |
| `03-drag-drop.spec.ts` | Drag series thumbnail → viewport pane; double-click fallback path |
| `04-window-level.spec.ts` | W/L independence across viewports (exact VOI values read from Cornerstone3D) |
| `05-network.spec.ts` | HTTP failures during load + request-count budget (catches per-instance-fetch regressions) |
| `06-measurements.spec.ts` | Length measurement create/track/delete via measurementService (ported from upstream Length/MeasurementPanel specs) |
| `07-viewport-transforms.spec.ts` | Invert/flip/rotate/zoom + Reset, asserted on Cornerstone3D viewport properties (ported from upstream Invert/FlipHorizontal/RotateRight/Reset specs) |
| `08-overlay-and-scroll.spec.ts` | W/L overlay text presence + update; mouse-wheel stack navigation (ported from upstream WindowLevelOverlayText) |
| `09-hanging-protocols.spec.ts` | MPR protocol yields multi-viewport layout with distinct orientations (ported from upstream MPR spec) |

Every test also auto-fails on unexpected console errors (`helpers/fixtures.ts`).

## Setup

```bash
cd projects/ohifRegressionTests
npm install
npx playwright install chromium
```

Auth: requires `XNAT_ALIAS` / `XNAT_SECRET` (an XNAT alias token) in the
workspace `.env` (two levels up) or a local `.env`. `global-setup.ts` exchanges
the token for a `JSESSIONID` — no SSO involved. Alias tokens expire (~2 days);
re-issue at XNAT → user menu → Manage Alias Tokens, or
`POST /data/services/tokens/issue` from a live session.

Optional `.env` overrides: `XNAT_BASE_URL`, `OHIF_TEST_PROJECT`,
`OHIF_TEST_SUBJECT`, `OHIF_TEST_EXPERIMENT`, `OHIF_TEST_LABEL`.

## Running

```bash
npm test               # full suite
npm run test:smoke     # load + metadata only
npm run test:headed    # watch it drive the browser
npm run report         # open last HTML report (traces/videos on failure)
npm run summary        # print test-results/summary.md from last run
```

After every run, a summary is written automatically to:

- `test-results/summary.md` — human-readable pass/fail report
- `test-results/summary.json` — machine-readable version for CI or scripts

## How the tests see inside OHIF

The viewer build exposes `window.services` (OHIF ServicesManager),
`window.cornerstone`, and `window.dicomWebConfig`. Tests assert against these
directly — e.g. `displaySetService.getActiveDisplaySets()` for metadata and
`cornerstoneViewportService.getCornerstoneViewport(id).getProperties().voiRange`
for window/level — so assertions are exact rather than pixel-guessing. If a
future build stops exposing these, keep them exposed (test builds at minimum);
they're the foundation of the suite.

## Extending

- **Regression test or it didn't happen**: every bug fix gets a spec.
- Ground-truth values (series names, instance counts) are pinned to study
  `CIRXNAT3_E00878` in project `CIR_OverreadsTest`. Keep that study frozen, or
  update `02-metadata.spec.ts` when it changes.
- For CI-per-PR, point `XNAT_BASE_URL` at a docker-composed XNAT with local
  accounts and the test study pre-seeded; production runs (this config) are
  suitable for scheduled synthetic monitoring.
- Screenshot baselines (`toHaveScreenshot`) should be generated inside the
  pinned Playwright Docker image so GPU/canvas rendering is deterministic.

## Known live findings (2026-07-09, production)

Captured while building this suite — the current suite fails on these, by design:

- All display sets: `PatientName`, `PatientID`, `StudyDate` **undefined**;
  study browser shows "Unknown"; header shows "Multiple Patients".
- All display sets: `SeriesNumber` = 0 (blank "S:" in series browser).
- `dicomWebConfig.enableStudyLazyLoad` is **false** with `wadouri` rendering —
  full per-scan metadata fetch up front; a prime suspect for slow loads on
  large studies (this one has ~100k instances across fMRI/dMRI series).
- Mixed-content error: page requests `http://…/app/template/Login.vm`
  manifest over HTTP from an HTTPS page (blocked by the browser).
- All four viewport overlay corners (`viewport-overlay-*`) render **empty** —
  no W/L text, no patient/study info (likely same metadata root cause).
- MPR activation logs an unhandled `TypeError: Cannot destructure property
  'context' of 'contextData' as it is null` via the OHIF error handler
  (MPR layout itself works — 3 viewports, correct orientations).

## Relationship to upstream tests

The fork (NenckaLab/Viewers, `overread-updates`, OHIF 3.13.0-beta.68) ships
upstream's full Playwright suite in `tests/` (~70 specs + page objects).
Those specs assert golden screenshots at fixed pixel coordinates against
OHIF's demo studies, so they can't run against XNAT data directly. Specs
06–09 here port the high-value *scenarios* (measurements, transforms,
overlays, MPR) re-asserted on OHIF service state and the pinned XNAT study.
Upstream's suite remains worth running in the fork's own CI against its
bundled `testdata` to catch non-XNAT regressions.
