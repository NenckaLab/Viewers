# AGENTS.md

This file provides guidance to AI coding agents (Claude, Codex, Cursor, and other LLM tools) when working with code in this repository.

## Project overview

This is **OHIF v3** (Open Health Imaging Foundation), an extensible web-based medical imaging viewer.

OHIF is organized around:

- **Extensions**: reusable functionality such as viewports, tools, panels, commands, data sources, and SOP Class handlers.
- **Modes**: workflow- and route-specific viewer configurations that compose extensions.
- **Platform packages**: shared application, service, and UI infrastructure.

## Agent workflow

Before editing:

1. Read this file, the nearest relevant `README.md`, and the affected package’s `package.json`.
2. Inspect one or two existing implementations of similar functionality before creating new files or abstractions.
3. Confirm scripts, paths, and package conventions from the repository. Do not assume a command or path exists.
4. Make the smallest focused change that fulfills the task. Avoid unrelated refactors.

When implementing:

- Prefer existing OHIF extension points and conventions.
- Use an extension for reusable functionality.
- Use a mode for route- or workflow-specific composition.
- Use services, commands, and pub/sub for cross-feature communication; avoid importing internal components or state directly from another extension.
- Reuse existing UI components, icons, hooks, providers, stores, and patterns before adding new ones.
- Clean up subscriptions, timers, Cornerstone resources, tool groups, and viewport registrations.
- Do not hard-code backend URLs, credentials, tokens, or environment-specific values.
- Do not log PHI, raw DICOM metadata, authorization headers, or tokens.

Before completing:

1. Run the narrowest relevant validation command available in the affected package.
2. Run lint, typecheck, tests, and build checks when relevant and practical.
3. For viewer changes, manually verify the affected mode with representative imaging data when possible.
4. Report files changed, checks run, and anything not verified.

## Development commands

### Main development

```bash
# Start development server for all packages
yarn dev
```

### Building

```bash
# Build all packages for production
yarn build

# Build the main viewer app
cd platform/app && yarn build
```

Always confirm available scripts in the relevant `package.json` before running commands.

## Architecture overview

### Monorepo structure

- `platform/` — core OHIF infrastructure
  - `app/` — main viewer application (`@ohif/viewer`)
  - `core/` — core services and utilities
  - `ui-next/` — modern UI component library
- `extensions/` — modular viewer functionality
- `modes/` — application workflow configurations

### Extension architecture

Extensions expose modules that the app dynamically loads, including viewports, tools, panels, commands, data sources, and SOP Class handlers. Keep extensions self-contained and interact with other functionality through documented modules, services, and commands.

Core extensions include:

- `cornerstone/` — medical image rendering engine integration
- `cornerstone-dicom-pmp/` — DICOM presentation state support
- `cornerstone-dicom-seg/` — DICOM segmentation support
- `cornerstone-dicom-sr/` — DICOM structured report support
- `dicom-pdf/` — DICOM PDF support
- `dicom-video/` — DICOM video support
- `measurement-tracking/` — measurement tracking
- `default/` — standard OHIF viewer functionality

### Modes

Modes compose extensions into a specific viewer workflow and route.

- Keep workflow-specific layout, toolbar, panels, display-set behavior, and route configuration in `modes/`.
- Declare extension dependencies explicitly.
- Reference extension modules by their registered IDs.
- Do not place reusable business logic in a mode; move it into an extension when it can serve multiple workflows.
- Preserve public mode IDs and routes unless the task explicitly requires a breaking change.

### Service-oriented design

OHIF uses a Services Manager and pub/sub pattern for non-UI state and cross-feature communication.

Common services include:

- Display Set Service
- Measurement Service
- Hanging Protocol Service
- UI Service
- Segmentation Service
- Viewport Grid Service
- Viewport Display Set History Service
- Viewport Dialog Service
- Notification Service
- Modal Service
- Dialog Service
- Customization Service
- Toolbar Service
- User Authentication Service
- Panel Service
- Cornerstone Viewport Service
- Tool Group Service
- Sync Group Service
- Cornerstone Cache Service

Most services use pub/sub and extend the pub/sub service interface at `pubSubServiceInterface.ts`.

Prefer OHIF service pub/sub for service events and cross-feature state. Use React effects for component lifecycle and local UI concerns. Always unsubscribe from service events during cleanup.

```ts
useEffect(() => {
  const subscriptions = [
    cornerstoneViewportService.subscribe(
      EVENTS.VIEWPORT_DATA_CHANGED,
      handleViewportDataChanged
    ),
    syncGroupService.subscribe(EVENTS.VIEWPORT_REMOVED, onHotKeyRemoval),
    syncGroupService.subscribe(EVENTS.VIEWPORT_ADDED, onHotKeyAddition),
  ];

  return () => {
    subscriptions.forEach(({ unsubscribe }) => unsubscribe());
  };
}, []);
```

### Commands Manager

The Commands Manager tracks named commands scoped to active contexts. When a command is run, OHIF resolves it from the active contexts in order.

Use:

```ts
commandsManager.runCommand(commandName, commandOptions);
```

Create commands in the extension’s commands module, such as `commandsModule.tsx` or `getCommandsModule.tsx`.

### Extension Manager

The Extension Manager aggregates registered extension modules, manages data sources, and exposes extension functionality across the application.

Use registered module IDs and public extension APIs rather than reaching into another extension’s implementation details.

### Build system

- Yarn Workspaces manage the monorepo.
- Webpack 5 provides module federation and dynamic extension loading.
- Extensions are auto-registered through the plugin import system, including `writePluginImportsFile.js`.
- Do not edit generated plugin-import artifacts unless the task explicitly requires it.

## Development patterns

### Adding new tools

1. Create the tool class in `extensions/cornerstone/src/tools/`.
2. Register it in the tool module’s `toolNames.ts`.
3. Add it to the toolbar through `getToolbarModule.tsx` when appropriate.
4. Add measurement-service mapping when needed.

### Creating extensions

Extensions typically include:

- `id.js` — unique extension identifier
- `index.tsx` — extension registration
- Module functions such as `getToolbarModule`, `getViewportModule`, and `getCommandsModule`

Follow the closest existing extension’s structure rather than introducing a new convention.

### Viewport customization

Custom viewports should extend the relevant Cornerstone viewport patterns.

- Keep viewport setup and teardown symmetrical.
- Avoid duplicate enabled elements, rendering engines, tool groups, event listeners, and viewport registrations.
- Add overlays, tools, and measurement behavior through established extension APIs.
- Verify the affected modality and viewport type after changes.

### Service integration

Register services through the extension’s `servicesManager.registerService` and access them through the services manager:

```ts
const { MeasurementService } = servicesManager.services;
```

Use services and commands for communication between extensions rather than direct imports of internal state or components.

### Stores, hooks, providers, and utilities

- Create extension-local stores in `stores/`; follow examples such as `useLutPresentationStore.ts` or `useSynchronizersStore.ts`.
- Create hooks in `hooks/`; follow examples such as `usePatientInfo.tsx`.
- Create providers in `providers/` or `contexts/`; follow examples such as `ViewportGridProvider.tsx`.
- Add custom synchronizers to `synchronizers/`; follow examples such as `frameViewSynchronizer.ts`.
- Add utilities to `utils/`; follow examples such as `formatPN.ts`.
- Add icons in `icons/` and register them using the established icon-registration utility.

### Overriding OHIF components

To customize a component, create the replacement in the extension’s `components/` directory and compose or register it through an extension or mode. Do not modify shared UI or core components when an extension-level solution is viable.

### Mode layout

A `layoutTemplate` returns a layout object. Follow an existing mode, such as `longitudinal/src/index.ts`, when changing a layout, side panels, toolbar configuration, or viewport arrangement.

## Change boundaries

Prefer extensions and modes over changes to `platform/core`.

Core changes are allowed only when all of the following are true:

- The requirement cannot be met through a documented extension, mode, service, command, or configuration point.
- The change is broadly reusable rather than specific to one deployment.
- Existing core patterns and tests are followed.
- The change includes appropriate tests and documentation.

Do not modify generated files, build output, dependency lockfiles, or vendored packages unless the task explicitly requires it.

Avoid changing public extension IDs, module IDs, mode IDs, routes, configuration keys, or APIs unless the task explicitly calls for it. Document migration steps for intentional breaking changes.

## Medical imaging and clinical safety

### DICOM support

OHIF supports medical imaging formats and workflows including CT, MR, X-Ray, Mammography, Ultrasound, RT, SEG, and SR.

- Prefer the existing DICOMweb data source when the backend supports DICOMweb.
- For custom backends, map data into OHIF’s naturalized DICOM JSON format through a data source.
- Use correct DICOM keywords and metadata conventions.
- Handle missing, malformed, and unsupported metadata gracefully.
- Never expose patient data, full study metadata, tokens, or authorization headers in logs, test fixtures, screenshots, or error reports.

### Hanging protocols

Hanging protocols define how images are arranged and displayed.

- They are commonly located in `hps/` directories.
- They include viewport and display-set rules, prior comparisons, and multi-monitor layouts.
- Treat hanging-protocol changes as workflow-impacting; verify initial viewport layout, series matching, and prior behavior.

### Measurements, segmentations, and rendering

Changes to measurement tools, segmentation, annotations, hanging protocols, display sets, or image rendering are high-impact.

- Preserve established clinical terminology and measurement semantics unless explicitly changing them.
- Test the affected modality, viewport type, interaction, persistence/export behavior, and relevant error states.
- Avoid expensive metadata transformations or synchronous processing in React render paths.

## Skills

The `ohif-test-agent` skill for Playwright E2E testing guidance is located at:

```text
.agents/skills/ohif-test-agent/
```

Use it when making or validating browser-based viewer changes.

## Completion checklist

- [ ] The change is implemented at the appropriate OHIF layer.
- [ ] Existing patterns were followed.
- [ ] Relevant subscriptions and resources are cleaned up.
- [ ] No PHI, secrets, or unsafe logging was introduced.
- [ ] Relevant lint, typecheck, tests, and/or build checks pass.
- [ ] Viewer behavior was manually exercised where feasible.
- [ ] No unrelated files were changed.
- [ ] New configuration, extension points, or user-visible behavior is documented.