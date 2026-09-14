# AGENTS.md

XNAT-OHIF agent contract for this viewer submodule (`ohifviewerxnat`). Prefer this file over generic OHIF agent docs. Java XAPI and plugin JAR scope: [../AGENTS.md](../AGENTS.md).

## Edit only XNAT packages

Unless the user explicitly directs otherwise, change only:

- `extensions/xnat/` — `@ohif/extension-xnat` (data, commands, panels, viewport, IO)
- `modes/xnat/` — `@ohif/mode-xnat` (route, layout, toolbar, tool groups)

Read anything. Do not edit `platform/`, other extensions/modes, lockfiles, generated files, or the Java plugin (`../src/main/java`) without naming the exact file, why it is required, and waiting for approval.

Put reusable viewer behavior in the extension. Put route, layout, toolbar, and workflow composition in the mode. Prefer an XNAT-local module, override, or mode config over any OHIF core change.

## Where to look

| Need | Path |
| --- | --- |
| Extension registration | `extensions/xnat/src/index.tsx` |
| Mode route, panels, overread | `modes/xnat/src/index.tsx` (see the `xnat` module-ID map) |
| XNAT REST / DICOMweb | `extensions/xnat/src/XNATDataSource/` |
| Session, project, CSRF | `extensions/xnat/src/utils/sessionMap.js`, `utils/IO/` |
| Public mode imports | `@ohif/extension-xnat` (`sessionMap`, `SessionRouter`, HP loaders, overread helpers) — not `@ohif/extension-xnat/src/...` |
| Commands | `extensions/xnat/src/commands/` wired by `commandsModule.ts` |
| Panels | `extensions/xnat/src/Panels/`, `getPanelModule.tsx` |
| XNAT UI | `extensions/xnat/src/xnat-components/` |
| Viewport | `extensions/xnat/src/Viewports/XNATCornerstoneViewport.tsx` |
| Hanging protocols | `extensions/xnat/src/hangingprotocols/`, `utils/hangingProtocol/` |
| Toolbar / tool groups | `modes/xnat/src/*Buttons.ts`, `initToolGroups.tsx` |

The mode already composes `modes/basic`. Follow that pattern. Do not copy more `platform/app` route code into XNAT.

## XNAT rules

- Session identity comes from the URL: `projectId`, `subjectId`, `experimentId`, `experimentLabel`, `overreadMode`, `parentProjectId`.
- Use `sessionMap` and `fetchCSRFToken` for XNAT REST. Do not hard-code hosts, credentials, or tokens.
- Select external hanging protocols with `xnathangingprotocolId`, never `hangingProtocolId`. Core resolves the latter before external JSON loads. Built-in protocol ids (e.g. `@ohif/mnGrid`) may still use `hangingProtocolId`.
- Overread vs regular panel sets are chosen in the mode from `servicesManager.services.isOverreadMode`.
- Reference other extensions by registered module IDs. Do not add new imports of another package’s internals.
- Create commands in the XNAT commands module; run them with `commandsManager.runCommand`.
- Clean up subscriptions, timers, Cornerstone resources, tool groups, and viewport registrations.
- Never log PHI, raw DICOM metadata, CSRF/`JSESSIONID`, Authorization headers, or tokens.
- Preserve DICOM, measurement, and segmentation semantics. Treat rendering, hanging protocols, and display sets as high-impact.

## Best practices

Derived from this workspace. Prefer neighboring files over these bullets
when they disagree.

| Practice | Evidence | Kind |
| --- | --- | --- |
| Mode imports from `@ohif/extension-xnat` public exports, never `@ohif/extension-xnat/src/...` | `modes/xnat/src/index.tsx`, `extensions/xnat/src/index.tsx` | observed |
| Reusable REST/HP/session helpers live in the extension; the mode only composes them | `extensions/xnat/src/utils/hangingProtocol/loadExternalHangingProtocols.ts` | observed |
| XNAT REST via `sessionMap.resolveUrl` / `joinUrl` + `fetchCSRFToken`; no host/cookie/token literals | `extensions/xnat/src/utils/sessionMap.js`, `utils/hangingProtocol/hangingProtocolApi.ts` | observed |
| External HP query param is `xnathangingprotocolId` | `modes/xnat/src/index.tsx` | observed |
| Do not log PHI, StudyInstanceUIDs, session maps, CSRF, or `JSESSIONID` | `extensions/xnat/src/Panels/XNATCustomFormsPanel.tsx` | observed |
| User-facing load failures use `uiDialogService` / `uiNotificationService`, not console-only | `extensions/xnat/src/sopClassHandler/DisplaySetProcessor.ts` | observed |
| New files in these packages are TypeScript; leave legacy `utils/IO` JS until a deliberate migration | `modes/xnat/src/*.ts`, `extensions/xnat/src/commands/*.ts` | observed |
| Unit tests sit next to source as `*.test.ts` / `*.test.js` | `extensions/xnat/src/utils/validations/areAllImageDimensionsEqual.test.ts` | observed |
| Do not add further `platform/app` deep imports | `modes/xnat/src/index.tsx` (`defaultRouteInit`) | gap |

### Do
- Export a new helper from `extensions/xnat/src/index.tsx` before the mode uses it.
- Wire panels/viewports with `@ohif/extension-xnat.panelModule.*` / `viewportModule.*` ids.
- Colocate a new unit test beside the file it covers.

### Do not
- Deep-import `@ohif/extension-cornerstone/src/...` or other package internals from the mode.
- Dump `window.location.search` or `sessionMap.getSession()` into the UI.
- Run `pnpm`/`yarn` `dev`/`build` unless the user asked.

## Workflow

1. Read this file and the affected XNAT `README.md` / `package.json`.
2. Inspect the nearest existing XNAT code before adding files or abstractions.
3. Make the smallest focused change. No unrelated refactors.
4. Keep public IDs stable: `@ohif/extension-xnat`, `@ohif/mode-xnat`, panel/command/module IDs, routes, and hanging protocol IDs.
5. Use precise types in TypeScript files. Do not introduce `any` or suppress errors without a reason.

## Validation

Do not start the viewer or run `pnpm`/`yarn` `dev`/`build` unless the user asks. This repo uses **pnpm** (Node 24+), not yarn.

When the user asks for checks, run the narrowest relevant lint, typecheck, or test. Playwright E2E guidance: `.agents/skills/ohif-test-agent/`.

Before finishing, report files changed, what you verified, and what you did not.
