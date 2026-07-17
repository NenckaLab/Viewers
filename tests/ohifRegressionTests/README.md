# OHIF/XNAT regression tests moved

This suite now lives in the shared Playwright harness:

`XNAT_playwright_testing` → `tests/plugins/ohif/`

From that repo (uses shared `XNAT_USERNAME` / `XNAT_PASSWORD` JSESSION auth):

```bash
npm run test:prod:ohif              # full suite
npm run test:prod:ohif:overread     # overread specs 10–13 only
npm run test:dev:ohif
npm run test:local:ohif:smoke       # load + metadata
```

Pinned study defaults (`OHIF_TEST_*`) and comparison experiment (`OHIF_TEST_EXPERIMENT_2`) are documented in that repo’s `.env.example` / README.

You can delete leftover `auth-state.json`, `playwright-report/`, and `test-results/` here when no longer needed.
