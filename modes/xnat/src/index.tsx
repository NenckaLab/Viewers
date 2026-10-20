import { hotkeys } from '@ohif/core';
import toolbarButtons from './toolbarButtons';
import { id } from './id';
import { defaultRouteInit } from '../../../platform/app/src/routes/Mode/defaultRouteInit';
import {
  SessionRouter,
  sessionMap,
  parseExcludedScanTypesParam,
  fetchExcludedScanTypesForProject,
  getExternalHangingProtocolRegistry,
  loadExternalHangingProtocols,
  fetchUserHangingProtocolOptions,
  buildStudyMappingsForExperiments,
  buildSyntheticStudyUIDs,
  fetchSubjectExperiments,
  isComparisonProtocolId,
  viewportOverlayCustomization,
} from '@ohif/extension-xnat';
import {
  mode as basicMode,
  modeInstance as basicModeInstance,
  extensionDependencies as basicDependencies,
  basicLayout,
  basicRoute,
  cornerstone,
  ohif,
  dicomsr,
  dicomvideo,
  dicompdf,
  dicomSeg,
  dicomPmap,
  dicomRT,
} from '../../basic/src/index';

import { createTools } from '../../segmentation/src/initToolGroups';

/** Match a query key regardless of casing (Mode uses lower-case keys). */
function getQueryParamIgnoreCase(searchParams: URLSearchParams, keyName: string): string | null {
  const target = keyName.toLowerCase();
  for (const [key, value] of searchParams) {
    if (key.toLowerCase() === target) {
      return value;
    }
  }
  return null;
}

function getHangingProtocolIdFromQuery(searchParams: URLSearchParams): string | null {
  return getQueryParamIgnoreCase(searchParams, 'hangingprotocolid');
}

/** XNAT-contained override for external protocols (avoids core pre-resolution). */
function getXnatHangingProtocolIdFromQuery(searchParams: URLSearchParams): string | null {
  return getQueryParamIgnoreCase(searchParams, 'xnathangingprotocolid');
}

function isOverreadSession(servicesManager?: any, query?: URLSearchParams): boolean {
  const search = query ?? new URLSearchParams(window.location.search);
  return (
    servicesManager?.services?.isOverreadMode === true || search.get('overreadMode') === 'true'
  );
}

/** Overread and anatomical share subject loading, nav, and hanging-protocol behavior. */
function isSubjectReviewSession(servicesManager?: any, query?: URLSearchParams): boolean {
  const search = query ?? new URLSearchParams(window.location.search);
  return (
    isOverreadSession(servicesManager, search) ||
    servicesManager?.services?.isAnatomicalMode === true ||
    search.get('anatomicalMode') === 'true'
  );
}

const xnat = {
  xnatNavList: '@ohif/extension-xnat.panelModule.xnatNavigation',
  studyBrowser: '@ohif/extension-xnat.panelModule.xnatStudyBrowser',
  segmentation: '@ohif/extension-xnat.panelModule.panelSegmentationWithTools',
  sopClassHandler: '@ohif/extension-xnat.sopClassHandlerModule.xnatSopClassHandler',
  measurements: '@ohif/extension-xnat.panelModule.xnatMeasurements',
  customForms: '@ohif/extension-xnat.panelModule.xnatCustomForms',
  overreadNavList: '@ohif/extension-xnat.panelModule.overreadNavigation',
  // XNAT viewport wrapper that fixes viewportId/enableViewport race when "No protocol matches"
  viewport: '@ohif/extension-xnat.viewportModule.xnatCornerstone',
};

const extensionDependencies = {
  ...basicDependencies,
  '@ohif/extension-measurement-tracking': '^3.11.0-beta.44',
  '@ohif/extension-xnat': '^0.0.1',
};

// Create a custom layout for XNAT that handles overread mode
const xnatLayout = {
  ...basicLayout,
  id: ohif.layout,
  props: {
    ...basicLayout.props,
    leftPanels: [xnat.studyBrowser, xnat.xnatNavList], // Default panels, will be overridden in route
    rightPanels: [xnat.segmentation, xnat.measurements], // Default panels, will be overridden in route
  },
};

// Create the XNAT route
const xnatRoute = {
  ...basicRoute,
  path: '/',
  layoutInstance: xnatLayout,
  layoutTemplate: ({ servicesManager }) => {
    const query = new URLSearchParams(window.location.search);
    const isOverreadMode = isOverreadSession(servicesManager, query);
    const isSubjectSession = isSubjectReviewSession(servicesManager, query);

    const rightPanels = isOverreadMode
      ? [xnat.segmentation, xnat.measurements, xnat.customForms]
      : [xnat.segmentation, xnat.measurements];

    const leftPanels = isSubjectSession
      ? [xnat.studyBrowser, xnat.overreadNavList]
      : [xnat.studyBrowser, xnat.xnatNavList];

    return {
      ...xnatLayout,
      props: {
        ...xnatLayout.props,
        leftPanels: leftPanels,
        rightPanels: rightPanels,
        viewports: [
          // Use XNAT viewport (wraps cornerstone) - fixes viewportId race when "No protocol matches"
          {
            namespace: xnat.viewport,
            displaySetsToDisplay: [
              xnat.sopClassHandler,
              ohif.sopClassHandler,
              dicomvideo.sopClassHandler,
              dicomsr.sopClassHandler3D,
              ohif.wsiSopClassHandler,
            ],
          },
          // Other viewports needed by XNAT
          {
            namespace: dicomsr.viewport,
            displaySetsToDisplay: [dicomsr.sopClassHandler, dicomsr.sopClassHandler3D],
          },
          {
            namespace: dicompdf.viewport,
            displaySetsToDisplay: [dicompdf.sopClassHandler],
          },
          {
            namespace: dicomSeg.viewport,
            displaySetsToDisplay: [dicomSeg.sopClassHandler],
          },
          {
            namespace: dicomPmap.viewport,
            displaySetsToDisplay: [dicomPmap.sopClassHandler],
          },
          {
            namespace: dicomRT.viewport,
            displaySetsToDisplay: [dicomRT.sopClassHandler],
          },
          {
            namespace: cornerstone.viewport,
            displaySetsToDisplay: [ohif.wsiSopClassHandler],
          },
        ],
      },
    };
  },
  init: async (
    { servicesManager, extensionManager, studyInstanceUIDs },
    hangingProtocolIdFromMode,
    stageIndexFromMode
  ) => {

    // Parse identifiers from URL query parameters for comparison views
    const query = new URLSearchParams(window.location.search);
    let xnatProtocolIdFromQuery = getXnatHangingProtocolIdFromQuery(query);
    const scanIdFromQuery = getQueryParamIgnoreCase(query, 'scanId');
    const studyUIDsFromURL = query.getAll('StudyInstanceUIDs').concat(query.getAll('studyInstanceUIDs'));
    const experimentIdsFromURL = query.getAll('experimentIds');
    const isOverreadMode = isOverreadSession(servicesManager, query);
    const isSubjectSession = isSubjectReviewSession(servicesManager, query);

    if (experimentIdsFromURL.length > 1) {
      // XNAT native approach: use experiment IDs for comparison
      // Create synthetic study UIDs based on experiment IDs with index for OHIF framework compatibility
      studyInstanceUIDs = experimentIdsFromURL.map((expId, index) => `xnat_experiment_${index}_${expId}`);
    } else if (studyUIDsFromURL.length > 0) {
      // Traditional approach: use parsed study UIDs
      studyInstanceUIDs = studyUIDsFromURL;
    }

    const hangingProtocolService = servicesManager.services.hangingProtocolService;

    // Load external hanging protocols before selecting active protocol IDs.
    // This lets admins update protocol JSON in XNAT (or another URL) without rebuilding the plugin.
    const externalProtocolIds = await loadExternalHangingProtocols({
      query,
      hangingProtocolService,
    });
    servicesManager.services.xnatExternalHangingProtocols = getExternalHangingProtocolRegistry();

    let ignoreSavedProtocolForComparison = false;
    let savedDefaultProtocolId: string | null = null;
    if (!scanIdFromQuery) {
      const projectId = getQueryParamIgnoreCase(query, 'projectId');
      if (projectId) {
        try {
          const hangingProtocolOptions = await fetchUserHangingProtocolOptions(projectId);
          savedDefaultProtocolId = hangingProtocolOptions.defaultProtocolId;
          ignoreSavedProtocolForComparison =
            hangingProtocolOptions.ignoreSavedProtocolForComparison;
          if (!xnatProtocolIdFromQuery && savedDefaultProtocolId) {
            // Honor the saved default even if the protocol module has not registered yet.
            // Actions-list launches pass xnathangingprotocolId in the URL; worklist popups
            // often omit it, and overread would otherwise fall back to the MPR default.
            xnatProtocolIdFromQuery = savedDefaultProtocolId;
            if (hangingProtocolService.getProtocolById(savedDefaultProtocolId)) {
              console.info('XNAT: Applying saved hanging protocol default for this project');
            } else {
              console.warn('XNAT: Saved hanging protocol default was not loaded for this project');
            }
          }
        } catch (error) {
          console.warn('XNAT: Could not load saved hanging protocol preference:', error);
        }
      }
    }

    // Overread and anatomical: load every subject experiment, newest first.
    // A prior experiment opens comparison MPR (newest on top, next-oldest on the bottom).
    let overreadExperimentIds: string[] = [];
    let overreadPrimaryExperiment: { ID: string; label?: string } | null = null;

    if (isSubjectSession && experimentIdsFromURL.length === 0) {
      const projectId = getQueryParamIgnoreCase(query, 'projectId');
      const subjectId = getQueryParamIgnoreCase(query, 'subjectId');
      if (projectId && subjectId) {
        try {
          const experiments = await fetchSubjectExperiments(projectId, subjectId);
          if (experiments.length > 0) {
            overreadExperimentIds = experiments.map(exp => exp.ID);
            overreadPrimaryExperiment = experiments[0];
            studyInstanceUIDs = buildSyntheticStudyUIDs(overreadExperimentIds);

            try {
              sessionStorage.setItem('xnat_experimentId', overreadPrimaryExperiment.ID);
              if (overreadPrimaryExperiment.label) {
                sessionStorage.setItem('xnat_experimentLabel', String(overreadPrimaryExperiment.label));
              }
              sessionStorage.setItem(
                'xnat_studyMappings',
                JSON.stringify(buildStudyMappingsForExperiments(overreadExperimentIds, projectId))
              );
            } catch (storageError) {
              console.warn(
                `${isOverreadMode ? 'XNAT Overread' : 'XNAT Anatomical'}: Unable to persist experiment selection:`,
                storageError
              );
            }

            const sessionLabel = isOverreadMode ? 'XNAT Overread' : 'XNAT Anatomical';
            const explicitHp =
              getXnatHangingProtocolIdFromQuery(query) || getHangingProtocolIdFromQuery(query);
            console.info(
              `${sessionLabel}: Loading ${overreadExperimentIds.length} subject experiment(s)` +
                (overreadExperimentIds.length > 1 && !explicitHp && !scanIdFromQuery
                  ? ' (comparison MPR)'
                  : isComparisonProtocolId(explicitHp)
                    ? ' (comparison HP)'
                    : ' (most recent)')
            );
          }
        } catch (error) {
          console.warn(
            `${isOverreadMode ? 'XNAT Overread' : 'XNAT Anatomical'}: Failed to load subject experiments for panel:`,
            error
          );
        }
      }
    }

    const explicitHangingProtocolId =
      getXnatHangingProtocolIdFromQuery(query) || getHangingProtocolIdFromQuery(query);
    const urlNamesAnotherProtocol =
      !!explicitHangingProtocolId &&
      !!savedDefaultProtocolId &&
      explicitHangingProtocolId !== savedDefaultProtocolId;
    // Newest experiment is index 0 (top row). The next experiment is index 1 (bottom row).
    // The saved-layout option skips that layout when a prior study is available.
    const openSubjectComparisonMpr =
      isSubjectSession &&
      overreadExperimentIds.length > 1 &&
      !scanIdFromQuery &&
      !urlNamesAnotherProtocol &&
      (ignoreSavedProtocolForComparison || !explicitHangingProtocolId);

    // Initialize data source
    try {
      const [dataSource] = extensionManager.getActiveDataSource();
      if (dataSource && typeof dataSource.initialize === 'function') {
        const query = new URLSearchParams(window.location.search);

        // Extract XNAT parameters from query for data source initialization
        const params: Record<string, any> = {
          projectId: query.get('projectId'),
          experimentId: overreadPrimaryExperiment?.ID || query.get('experimentId'),
          sessionId: overreadPrimaryExperiment?.ID || query.get('experimentId'), // experimentId can be used as sessionId
          subjectId: query.get('subjectId'),
          parentProjectId: query.get('parentProjectId'),
          experimentLabel:
            (overreadPrimaryExperiment?.label as string | undefined) || query.get('experimentLabel'),
          scanId: getQueryParamIgnoreCase(query, 'scanId'),
          hangingProtocolId:
            (openSubjectComparisonMpr ? '@ohif/mrSubjectComparison' : null) ||
            explicitHangingProtocolId ||
            xnatProtocolIdFromQuery ||
            (typeof hangingProtocolIdFromMode === 'string' && hangingProtocolIdFromMode) ||
            null,
        };

        const projectIdsFromURL = query.getAll('projectIds');
        const experimentIdsFromURL = query.getAll('experimentIds');
        const studyUIDsFromURL = studyInstanceUIDs || [];

        // Check if we're using experiment IDs for comparison (XNAT native approach)
        const experimentIdsParam =
          overreadExperimentIds.length > 0 ? overreadExperimentIds : query.getAll('experimentIds');
        const isExperimentBasedComparison = experimentIdsParam.length > 1;

        const buildStudyMappings = () => {
          const mappings: Record<
            string,
            {
              projectId?: string;
              experimentId?: string;
            }
          > = {};

          // For comparison views with hangingProtocolId, allow cross-experiment studies
          const hpFromQuery = getHangingProtocolIdFromQuery(query);
          const isComparisonView = isComparisonProtocolId(hpFromQuery);

          if (isExperimentBasedComparison) {
            // Handle experiment ID based comparison / overread multi-experiment load
            experimentIdsParam.forEach((experimentId, index) => {
              if (experimentId) {
                // Create mapping key using the synthetic UID format that matches what we created above
                const mappingKey = `xnat_experiment_${index}_${experimentId}`;
                mappings[mappingKey] = {
                  projectId: params.projectId || sessionStorage.getItem('xnat_projectId'),
                  experimentId: experimentId,
                };
              }
            });
          } else {
            // Handle traditional study UID based approach
            studyUIDsFromURL.forEach((uid, index) => {
              if (!uid) {
                return;
              }

              // Try to get project/experiment from URL arrays first
              let projectIdForUID = projectIdsFromURL[index];
              let experimentIdForUID = experimentIdsFromURL[index];

              // For comparison views, if we don't have specific mappings,
              // allow the data source to determine them dynamically
              if (isComparisonView && !projectIdForUID && !experimentIdForUID) {
                // For comparison views, we'll let the data source try to resolve
                // each study individually rather than restricting to one experiment
                return; // Skip adding a mapping, let data source resolve dynamically
              }

              // Fallback to single values from URL or session storage
              projectIdForUID = projectIdForUID || params.projectId || sessionStorage.getItem('xnat_projectId');
              experimentIdForUID = experimentIdForUID || params.experimentId || sessionStorage.getItem('xnat_experimentId');

              if (projectIdForUID || experimentIdForUID) {
                mappings[uid] = {
                  projectId: projectIdForUID,
                  experimentId: experimentIdForUID,
                };
              }
            });
          }

          if (!Object.keys(mappings).length) {
            try {
              const cachedMappings = sessionStorage.getItem('xnat_studyMappings');
              if (cachedMappings) {
                return JSON.parse(cachedMappings);
              }
            } catch (error) {
              console.warn('XNAT Route Init: Unable to parse cached study mappings:', error);
            }
          }

          return mappings;
        };

        const studyMappings = buildStudyMappings();

        // Filter out null/undefined values
        Object.keys(params).forEach(key => {
          if (!params[key]) delete params[key];
        });

        if (Object.keys(studyMappings).length) {
          params.studyMappings = studyMappings;
        }

        await dataSource.initialize({ params, query });
      } else {
        console.error('XNAT Mode Route Init: Could not find active data source or initialize function.');
      }
    } catch (error) {
      console.error('XNAT Mode Route Init: Error calling dataSource.initialize():', error);
      return;
    }

    // Hanging protocol: Mode.tsx already resolved URL `hangingProtocolId` / mode default into
    // `hangingProtocolIdFromMode` (string = explicit choice, array = match among actives).
    // Multi-study / comparison still forces hpCompare unless we only rely on URL elsewhere.
    let hangingProtocolId: string | undefined;

    const isMultiStudy = studyInstanceUIDs && studyInstanceUIDs.length > 1;
    const urlHp = xnatProtocolIdFromQuery || (
      typeof hangingProtocolIdFromMode === 'string' ? hangingProtocolIdFromMode : null
    );
    const explicitFromQuery = getHangingProtocolIdFromQuery(query);
    const wantsComparison =
      isComparisonProtocolId(urlHp) || isComparisonProtocolId(explicitFromQuery);

    // Non-subject multi-study launches still use the 2×2 compare layout.
    // Subject sessions with a prior use comparison MPR instead.
    const shouldForceComparisonFromMultiStudy = isMultiStudy && !isSubjectSession;

    // Determine which specific comparison protocol was requested (if any).
    // Prefer the explicit URL query parameter over the mode/xnat protocol id.
    const requestedComparisonProtocol =
      (isComparisonProtocolId(explicitFromQuery) ? explicitFromQuery : null) ||
      (isComparisonProtocolId(urlHp) ? urlHp : null);

    if (openSubjectComparisonMpr || requestedComparisonProtocol === '@ohif/mrSubjectComparison') {
      // 3×2 MPR: newest study on the top row, prior study on the bottom row.
      hangingProtocolId = '@ohif/mrSubjectComparison';
      hangingProtocolService.setActiveProtocolIds(['@ohif/mrSubjectComparison', '@ohif/hpCompare', 'default']);
    } else if (shouldForceComparisonFromMultiStudy || wantsComparison) {
      hangingProtocolId = '@ohif/hpCompare';
      hangingProtocolService.setActiveProtocolIds(['@ohif/hpCompare', 'default']);
    } else if (urlHp) {
      // Query string (or Mode) requested a specific protocol — do not overwrite with XNAT defaults
      hangingProtocolId = urlHp;
      hangingProtocolService.setActiveProtocolIds(urlHp);
    } else {
      // No URL override: subject sessions prefer MPR, same as overread.
      const protocolIds = isSubjectSession
        ? [
          'mpr', // Prioritize MPR in overread mode
          'default',
          'main3D',
          'mprAnd3DVolumeViewport',
          'only3D',
          'primary3D',
          'primaryAxial',
          'fourUp',
        ]
        : [
          'default',
          'mpr',
          'main3D',
          'mprAnd3DVolumeViewport',
          'only3D',
          'primary3D',
          'primaryAxial',
          'fourUp',
        ];

      const activeIds = Array.from(new Set([...protocolIds, ...externalProtocolIds]));
      hangingProtocolService.setActiveProtocolIds(activeIds);

      // Keep stack `default` intact so volume/MPR failures can fall back to it.
      // Overread still prefers MPR via protocolIds order above.

      // Let HangingProtocolService.run() match among active protocols (same as stock route)
      hangingProtocolId = undefined;
    }

    // Now call defaultRouteInit
    const [dataSourceForDefaultRoute] = extensionManager.getActiveDataSource();


    const unsubscriptions = await defaultRouteInit(
      {
        servicesManager,
        studyInstanceUIDs,
        dataSource: dataSourceForDefaultRoute,
      },
      hangingProtocolId,
      stageIndexFromMode
    );

    return unsubscriptions;
  },
};

// Create the mode instance by extending the basic mode instance
const modeInstance = {
  ...basicModeInstance,
  id,
  routeName: '',
  displayName: ({ servicesManager }) => {
    const isOverreadMode = servicesManager?.services?.isOverreadMode === true;
    return isOverreadMode ? 'XNAT Overread Viewer' : 'XNAT Viewer';
  },
  onModeInit: ({ servicesManager, extensionManager, commandsManager, appConfig, query }) => {
    // Get query parameters
    const queryParams = Object.fromEntries(query.entries());
    const { projectId, parentProjectId, subjectId, experimentId, experimentLabel, overreadMode, anatomicalMode, excludeScanTypes, scanId } = queryParams;

    // Check if we have StudyInstanceUIDs in the URL (for comparison views)
    const studyUIDsFromURL = query.getAll('StudyInstanceUIDs').concat(query.getAll('studyInstanceUIDs'));
    const hasStudyInstanceUIDs = studyUIDsFromURL.length > 0;

    // Check if we have multiple experiments (comparison mode)
    const experimentIdsFromURL = query.getAll('experimentIds');
    const hasMultipleExperiments = experimentIdsFromURL.length > 1;

    // Store overread mode flag in services manager for use in layout
    if (overreadMode === 'true') {
      servicesManager.services.isOverreadMode = true;
    }

    // Anatomical mode follows the overread subject session. Custom forms stay on overread only.
    if (anatomicalMode === 'true') {
      servicesManager.services.isAnatomicalMode = true;
    }

    const excludedScanTypesFromUrl = parseExcludedScanTypesParam(excludeScanTypes);
    if (excludedScanTypesFromUrl.length > 0) {
      servicesManager.services.excludedScanTypes = excludedScanTypesFromUrl;
    }

    if ((overreadMode === 'true' || anatomicalMode === 'true') && projectId) {
      fetchExcludedScanTypesForProject(projectId).then(fetchedExcludedScanTypes => {
        if (fetchedExcludedScanTypes.length > 0) {
          const merged = new Set([
            ...(servicesManager.services.excludedScanTypes || []),
            ...fetchedExcludedScanTypes,
          ]);
          servicesManager.services.excludedScanTypes = Array.from(merged);
        }
      });
    }

    // Set session map parameters if available
    const safeSetSessionValue = (key: string, value?: string) => {
      if (value) {
        try {
          sessionStorage.setItem(key, value);
        } catch (error) {
          console.warn(`XNAT Mode Init - Unable to persist ${key}:`, error);
        }
      }
    };

    if (projectId) {
      sessionMap.setProject(projectId);
      safeSetSessionValue('xnat_projectId', projectId);
    }
    if (subjectId) {
      sessionMap.setSubject(subjectId);
      safeSetSessionValue('xnat_subjectId', subjectId);
    }
    if (parentProjectId) {
      sessionMap.setParentProject(parentProjectId);
      safeSetSessionValue('xnat_parentProjectId', parentProjectId);
    }
    if (experimentId) {
      safeSetSessionValue('xnat_experimentId', experimentId);
    }
    if (scanId) {
      servicesManager.services.scanId = scanId;
      safeSetSessionValue('xnat_scanId', scanId);
    }

    // Initialize session router if we have single experiment parameters, or skip for comparison/multi-experiment modes
    if (experimentId && projectId && !hasMultipleExperiments) {
      try {
        const sessionRouter = new SessionRouter(
          projectId,
          parentProjectId,
          subjectId,
          experimentId,
          experimentLabel
        );

        servicesManager.services.sessionRouter = sessionRouter;

        const layoutService = servicesManager.services.layoutService;
        if (layoutService) {
          layoutService.setLayout({
            numRows: 1,
            numCols: 1,
            layoutType: 'grid',
          });
        }
      } catch (error) {
        console.error('XNAT Mode Init - Error creating session router:', error);
      }
    } else if (hasStudyInstanceUIDs || hasMultipleExperiments) {
      // We have StudyInstanceUIDs or multiple experiments, let the route init handle loading
    } else {
      console.warn('XNAT Mode Init - Missing required params for session router');
    }
  },
  onModeEnter: ({ servicesManager, extensionManager, commandsManager }) => {
    // Call the basic mode's onModeEnter first
    basicModeInstance.onModeEnter({ servicesManager, extensionManager, commandsManager });

    // Register XNAT-specific toolbar buttons
    const { toolbarService, toolGroupService } = servicesManager.services;
    toolbarService.register(toolbarButtons);

    // Replace the basic 'default' tool group with segmentation tools plus basic measurement tools
    const utilityModule = extensionManager.getModuleEntry(
      '@ohif/extension-cornerstone.utilityModule.tools'
    );
    const { toolNames, Enums } = utilityModule.exports;
    const segmentationTools = createTools({ commandsManager, utilityModule });

    // Add missing basic measurement tools that are not in segmentation tools.
    // Use utility toolNames (not string literals) so hasTool() matches Cornerstone registration.
    const basicMeasurementTools = {
      passive: [
        { toolName: toolNames.Length },
        { toolName: toolNames.Bidirectional },
        { toolName: toolNames.ArrowAnnotate },
        { toolName: toolNames.Angle },
        { toolName: toolNames.CobbAngle },
        { toolName: toolNames.Probe },
        { toolName: toolNames.RectangleROI },
        { toolName: toolNames.CircleROI },
        { toolName: toolNames.EllipticalROI },
        { toolName: toolNames.PlanarFreehandROI },
        { toolName: toolNames.SplineROI },
        { toolName: toolNames.LivewireContour },
        ...(toolNames.CalibrationLine ? [{ toolName: toolNames.CalibrationLine }] : []),
      ],
    };

    // Merge segmentation tools with basic measurement tools
    const allTools = {
      active: segmentationTools.active,
      passive: [...segmentationTools.passive, ...basicMeasurementTools.passive],
      disabled: segmentationTools.disabled || [],
    };

    // Destroy the basic tool group and recreate with combined tools
    toolGroupService.destroyToolGroup('default');
    toolGroupService.createToolGroupAndAddTools('default', allTools);

    // MPR and other hanging protocols that use the 'mpr' tool group have full
    // access to the segmentation tool set (Brush, Threshold, MarkerLabelmap, etc.).
    const existingMprGroup = toolGroupService.getToolGroup('mpr');
    const crosshairsConfig = existingMprGroup?.hasTool('Crosshairs')
      ? existingMprGroup.getToolConfiguration('Crosshairs') || {}
      : null;

    try {
      toolGroupService.destroyToolGroup('mpr');
    } catch (e) {
      // Ignore if it doesn't exist yet
    }

    const mprTools = {
      ...allTools,
      disabled: [
        ...(allTools.disabled || []),
        ...(crosshairsConfig
          ? [
            {
              toolName: toolNames.Crosshairs,
              bindings: [{ mouseButton: Enums.MouseBindings.Primary }],
              configuration: {
                ...crosshairsConfig,
                // Keep crosshairs visible when switching to another tool.
                disableOnPassive: false,
              },
            },
          ]
          : []),
      ],
    };

    toolGroupService.createToolGroupAndAddTools('mpr', mprTools);

    const isSubjectSession = isSubjectReviewSession(servicesManager);

    const {
      customizationService,
    } = servicesManager.services;

    // Suppress verbose J2K decoder logs
    try {
      const windowWithLog = window as any;
      if (windowWithLog.log && windowWithLog.log.getLogger) {
        const dicomLoader = windowWithLog.log.getLogger('cs3d.dicomImageLoader');
        if (dicomLoader && dicomLoader.setLevel) {
          dicomLoader.setLevel('WARN');
        }
      }
    } catch (e) {
      console.warn('Could not configure J2K logging level:', e);
    }

    // Ensure viewport corner overlays (date, series, W/L, instance) are registered at mode scope.
    customizationService.setCustomizations(
      viewportOverlayCustomization as Record<string, unknown>
    );

    // Set up XNAT-specific customizations
    customizationService.setCustomizations({
      'panelSegmentation.readableText': {
        $set: {
          min: 'Min Value',
          max: 'Max Value',
          mean: 'Mean Value',
          stdDev: 'Standard Deviation',
          count: 'Voxel Count',
          volume: 'Volume',
        },
      },
      'panelSegmentation.disableEditing': { $set: false },
      'panelSegmentation.showAddSegment': { $set: true },
      'panelSegmentation.tableMode': { $set: 'collapsed' },
      'cornerstoneViewportClickCommands': {
        $set: {
          doubleClick: ['toggleOneUp'],
          button1: ['closeContextMenu'],
          button3: [
            {
              commandName: 'showCornerstoneContextMenu',
              commandOptions: {
                requireNearbyToolData: true,
                menuId: 'measurementsContextMenu',
              },
            },
          ],
        },
      },
      ...(isSubjectSession && {
        'worklist.showStudyList': { $set: false },
        'worklist.showPatientInfo': { $set: false },
      }),
    });

    // Set up toolbar sections specific to XNAT.
    // clearButtonSection is required: updateSection appends when the section already
    // exists (basic mode registers it first), which would leave new buttons at the end.
    toolbarService.clearButtonSection(toolbarService.sections.primary);
    toolbarService.updateSection(toolbarService.sections.primary, [
      'returnToXNAT',
      'MeasurementTools',
      'Zoom',
      'Pan',
      'ViewportLock',
      'TrackballRotate',
      'WindowLevel',
      'Layout',
      'Crosshairs',
      'MoreTools',
    ]);

    // Populate the MeasurementTools / MoreTools select lists. Basic mode used to
    // do this via cornerstone.toolbarSections, which is no longer registered.
    toolbarService.clearButtonSection('MeasurementTools');
    toolbarService.updateSection('MeasurementTools', [
      'Length',
      'Bidirectional',
      'ArrowAnnotate',
      'EllipticalROI',
      'RectangleROI',
      'CircleROI',
      'PlanarFreehandROI',
      'SplineROI',
      'LivewireContour',
    ]);
    toolbarService.clearButtonSection('MoreTools');
    toolbarService.updateSection('MoreTools', [
      'Reset',
      'rotate-right',
      'flipHorizontal',
      'ImageSliceSync',
      'ReferenceLines',
      'ImageOverlayViewer',
      'StackScroll',
      'invert',
      'Probe',
      'Cine',
      'Angle',
      'CobbAngle',
      'Magnify',
      'CalibrationLine',
      'TagBrowser',
      'AdvancedMagnify',
      'UltrasoundDirectionalTool',
      'WindowLevelRegion',
    ]);

    // Per-viewport orientation (axial/sagittal/coronal/acquisition) lives in the
    // viewport action corners, not the primary toolbar. Re-apply these sections
    // after the primary rebuild so each viewport keeps its plane selector.
    toolbarService.clearButtonSection(toolbarService.sections.viewportActionMenu.topLeft);
    toolbarService.updateSection(toolbarService.sections.viewportActionMenu.topLeft, [
      'orientationMenu',
      'dataOverlayMenu',
    ]);
    toolbarService.clearButtonSection(toolbarService.sections.viewportActionMenu.bottomMiddle);
    toolbarService.updateSection(toolbarService.sections.viewportActionMenu.bottomMiddle, [
      'AdvancedRenderingControls',
    ]);
    toolbarService.clearButtonSection('AdvancedRenderingControls');
    toolbarService.updateSection('AdvancedRenderingControls', [
      'windowLevelMenuEmbedded',
      'voiManualControlMenu',
      'Colorbar',
      'opacityMenu',
      'thresholdMenu',
    ]);
    toolbarService.clearButtonSection(toolbarService.sections.viewportActionMenu.topRight);
    toolbarService.updateSection(toolbarService.sections.viewportActionMenu.topRight, [
      'modalityLoadBadge',
      'trackingStatus',
      'navigationComponent',
    ]);
    toolbarService.clearButtonSection(toolbarService.sections.viewportActionMenu.bottomLeft);
    toolbarService.updateSection(toolbarService.sections.viewportActionMenu.bottomLeft, [
      'windowLevelMenu',
    ]);

    // Set up segmentation toolbox sections
    toolbarService.updateSection(toolbarService.sections.segmentationToolbox, [
      'SegmentationUtilities',
      'SegmentationTools',
    ]);
    toolbarService.updateSection('SegmentationUtilities', [
      'LabelmapSlicePropagation',
      'InterpolateLabelmap',
      'SegmentBidirectional',
    ]);
    toolbarService.updateSection('SegmentationTools', [
      'MarkerLabelmap',
      'RegionSegmentPlus',
      'Shapes',
      'Threshold',
      'Brush',
      'Eraser',
    ]);
    toolbarService.updateSection('BrushTools', ['Brush', 'Eraser', 'Threshold']);
  },
  routes: [xnatRoute],
  extensions: extensionDependencies,
  hangingProtocol: [
    'default',
    'mpr',
    'main3D',
    'mprAnd3DVolumeViewport',
    'only3D',
    'primary3D',
    'primaryAxial',
    'fourUp',
    '@ohif/mrSubjectComparison',
    '@ohif/hpCompare',
  ],
  sopClassHandlers: [
    xnat.sopClassHandler,
    dicomvideo.sopClassHandler,
    dicomSeg.sopClassHandler,
    dicomPmap.sopClassHandler,
    ohif.sopClassHandler,
    ohif.wsiSopClassHandler,
    dicompdf.sopClassHandler,
    dicomsr.sopClassHandler3D,
    dicomsr.sopClassHandler,
    dicomRT.sopClassHandler,
  ],
  dataSourcesConfig: {
    xnat: {
      friendlyName: 'XNAT Viewer',
      isValidStudyUID: true,
      isValidationRequired: false,
    }
  },
};

const mode = {
  ...basicMode,
  id,
  modeInstance,
  extensionDependencies,
};

export default mode;
export { toolbarButtons };