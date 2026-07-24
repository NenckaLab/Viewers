# OHIF Regression Test Summary

**Run status:** passed
**When:** 2026-07-10T20:27:48.376Z
**Target:** http://localhost
**Study:** S003_MR_1 (XNAT_E00006)
**Viewer URL:** http://localhost/VIEWER/?subjectId=XNAT_S00003&projectId=Sandbox&experimentId=XNAT_E00006&experimentLabel=S003_MR_1
**Duration:** 55.9s

## Totals

| Passed | Failed | Skipped |
|--------|--------|---------|
| 14 | 0 | 0 |

## Passed

- [PASS] **overreadMode activates service flag and overread UI chrome** (`10-overread-activation.spec.ts`, 5.0s)
- [PASS] **overread mode shows Custom Forms and Subject Navigation tabs** (`10-overread-activation.spec.ts`, 4.3s)
- [PASS] **regular mode does not show Custom Forms or Overread Navigation tabs** (`10-overread-activation.spec.ts`, 4.5s)
- [PASS] **Custom Forms panel shows OVERREAD MODE badge and study context** (`10-overread-activation.spec.ts`, 4.4s)
- [PASS] **Overread Navigation panel lists This Subject** (`10-overread-activation.spec.ts`, 4.6s)
- [PASS] **overread URL retains overreadMode after load** (`10-overread-activation.spec.ts`, 4.1s)
- [PASS] **loads mocked overread form and renders fields** (`11-overread-forms.spec.ts`, 3.1s)
- [PASS] **shows existing-data indicator when has-data API returns true** (`11-overread-forms.spec.ts`, 3.0s)
- [PASS] **save PUTs overread custom-fields and shows success** (`11-overread-forms.spec.ts`, 3.1s)
- [PASS] **save error surfaces Error section when PUT fails** (`11-overread-forms.spec.ts`, 3.0s)
- [PASS] **multi-experiment overread shows experiment selector** (`12-overread-comparison.spec.ts`, 3.2s)
- [PASS] **overread mode still loads display sets for the study** (`13-overread-navigation.spec.ts`, 4.0s)
- [PASS] **excludeScanTypes query is preserved on the overread URL** (`13-overread-navigation.spec.ts`, 4.0s)
- [PASS] **Subject Navigation expands without console-breaking errors** (`13-overread-navigation.spec.ts`, 4.5s)
