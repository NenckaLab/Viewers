import { hotkeys } from '@ohif/core';
import toolbarButtons from './toolbarButtons';
import { id } from './id';
import SessionRouter from '@ohif/extension-xnat/src/xnat-components/XNATNavigation/helpers/SessionRouter.js';
import { defaultRouteInit } from '../../../platform/app/src/routes/Mode/defaultRouteInit';
import sessionMap from '@ohif/extension-xnat/src/utils/sessionMap.js';
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

// Import segmentation tools initialization
import { createTools } from '../../segmentation/src/initToolGroups';
import {
  getExternalHangingProtocolRegistry,
  loadExternalHangingProtocols,
} from './loadExternalHangingProtocols';

/** Match `hangingProtocolId` regardless of query key casing (Mode uses lower-case keys). */
function getHangingProtocolIdFromQuery(searchParams: URLSearchParams): string | null {
  for (const [key, value] of searchParams) {
    if (key.toLowerCase() === 'hangingprotocolid') {
      return value;
    }
  }
  return null;
}

/** XNAT-contained override for external protocols (avoids core pre-resolution). */
function getXnatHangingProtocolIdFromQuery(searchParams: URLSearchParams): string | null {
  for (const [key, value] of searchParams) {
    if (key.toLowerCase() === 'xnathangingprotocolid') {
      return value;
    }
  }
  return null;
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
    // Check if we're in overread mode
    const isOverreadMode = servicesManager?.services?.isOverreadMode === true;

    // Choose panels based on mode
    const rightPanels = isOverreadMode
      ? [xnat.segmentation, xnat.measurements, xnat.customForms]  // Overread mode: include custom forms
      : [xnat.segmentation, xnat.measurements];                   // Regular mode: standard panels

    const leftPanels = isOverreadMode
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
    const xnatProtocolIdFromQuery = getXnatHangingProtocolIdFromQuery(query);
    const studyUIDsFromURL = query.getAll('StudyInstanceUIDs').concat(query.getAll('studyInstanceUIDs'));
    const experimentIdsFromURL = query.getAll('experimentIds');

    // Check if we're in a comparison view (either experiment-based or study-based)
    const isComparisonView = experimentIdsFromURL.length > 1 || studyUIDsFromURL.length > 1;

    if (experimentIdsFromURL.length > 1) {
      // XNAT native approach: use experiment IDs for comparison
      // Create synthetic study UIDs based on experiment IDs with index for OHIF framework compatibility
      studyInstanceUIDs = experimentIdsFromURL.map((expId, index) => `xnat_experiment_${index}_${expId}`);
    } else if (studyUIDsFromURL.length > 0) {
      // Traditional approach: use parsed study UIDs
      studyInstanceUIDs = studyUIDsFromURL;
    } else if (!isComparisonView) {
      // For single study views, keep the original studyInstanceUIDs from SessionRouter
      console.log('XNAT Route Init: Using original studyInstanceUIDs from SessionRouter:', studyInstanceUIDs);
    }

    const hangingProtocolService = servicesManager.services.hangingProtocolService;

    // Load external hanging protocols before selecting active protocol IDs.
    // This lets admins update protocol JSON in XNAT (or another URL) without rebuilding the plugin.
    const externalProtocolIds = await loadExternalHangingProtocols({
      query,
      hangingProtocolService,
    });
    servicesManager.services.xnatExternalHangingProtocols = getExternalHangingProtocolRegistry();

    // Initialize data source
    try {
      const [dataSource] = extensionManager.getActiveDataSource();
      if (dataSource && typeof dataSource.initialize === 'function') {
        const query = new URLSearchParams(window.location.search);

        // Extract XNAT parameters from query for data source initialization
        const params: Record<string, any> = {
          projectId: query.get('projectId'),
          experimentId: query.get('experimentId'),
          sessionId: query.get('experimentId'), // experimentId can be used as sessionId
          subjectId: query.get('subjectId'),
          parentProjectId: query.get('parentProjectId'),
          experimentLabel: query.get('experimentLabel'),
          hangingProtocolId:
            xnatProtocolIdFromQuery ||
            (typeof hangingProtocolIdFromMode === 'string' && hangingProtocolIdFromMode) ||
            getHangingProtocolIdFromQuery(query), // Pass to data source for special handling
        };

        const projectIdsFromURL = query.getAll('projectIds');
        const experimentIdsFromURL = query.getAll('experimentIds');
        const studyUIDsFromURL = studyInstanceUIDs || [];

        // Check if we're using experiment IDs for comparison (XNAT native approach)
        const experimentIdsParam = query.getAll('experimentIds');
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
          const isComparisonView = ['@ohif/mrSubjectComparison', '@ohif/hpCompare'].includes(hpFromQuery);

          if (isExperimentBasedComparison) {
            // Handle experiment ID based comparison (XNAT native)
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

    // Check if we're in overread mode
    const isOverreadMode = servicesManager?.services?.isOverreadMode === true;

    // Hanging protocol: Mode.tsx already resolved URL `hangingProtocolId` / mode default into
    // `hangingProtocolIdFromMode` (string = explicit choice, array = match among actives).
    // Multi-study / comparison still forces hpCompare unless we only rely on URL elsewhere.
    let hangingProtocolId: string | undefined;

    const isMultiStudy = studyInstanceUIDs && studyInstanceUIDs.length > 1;
    const urlHp = xnatProtocolIdFromQuery || (
      typeof hangingProtocolIdFromMode === 'string' ? hangingProtocolIdFromMode : null
    );
    const comparisonProtocolIds = ['@ohif/mrSubjectComparison', '@ohif/hpCompare'];
    const explicitFromQuery = getHangingProtocolIdFromQuery(query);
    const wantsComparison =
      (urlHp && comparisonProtocolIds.includes(urlHp)) ||
      (explicitFromQuery && comparisonProtocolIds.includes(explicitFromQuery));

    // Determine which specific comparison protocol was requested (if any).
    // Prefer the explicit URL query parameter over the mode/xnat protocol id.
    const requestedComparisonProtocol =
      (explicitFromQuery && comparisonProtocolIds.includes(explicitFromQuery) ? explicitFromQuery : null) ||
      (urlHp && comparisonProtocolIds.includes(urlHp) ? urlHp : null);

    if (isMultiStudy || wantsComparison) {
      if (requestedComparisonProtocol === '@ohif/mrSubjectComparison') {
        // MPR 3×2 side-by-side comparison was explicitly requested
        hangingProtocolId = '@ohif/mrSubjectComparison';
        hangingProtocolService.setActiveProtocolIds(['@ohif/mrSubjectComparison', '@ohif/hpCompare', 'default']);
      } else {
        // Default 2×2 compare layout
        hangingProtocolId = '@ohif/hpCompare';
        hangingProtocolService.setActiveProtocolIds(['@ohif/hpCompare', 'default']);
      }
    } else if (urlHp) {
      // Query string (or Mode) requested a specific protocol — do not overwrite with XNAT defaults
      hangingProtocolId = urlHp;
      hangingProtocolService.setActiveProtocolIds(urlHp);
    } else {
      // No URL override: single-study defaults + optional overread MPR fallback
      const protocolIds = isOverreadMode
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

      if (isOverreadMode) {
        const mprProtocol = hangingProtocolService.getProtocolById('mpr');
        if (mprProtocol) {
          const overreadDefaultProtocol = {
            ...mprProtocol,
            id: 'default',
            name: 'Overread Default (MPR)',
          };
          hangingProtocolService.addProtocol('default', overreadDefaultProtocol);
        }
      }

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
    const { projectId, parentProjectId, subjectId, experimentId, experimentLabel, overreadMode } = queryParams;

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
        { toolName: toolNames.SplineROI },
        { toolName: toolNames.LivewireContour },
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

    const isOverreadMode = servicesManager?.services?.isOverreadMode === true;

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

    // Load cornerstone extension's customizations first
    try {
      const cornerstoneCustomizations = extensionManager.getModuleEntry('@ohif/extension-cornerstone.customizationModule.default');
      if (cornerstoneCustomizations && typeof cornerstoneCustomizations === 'object') {
        customizationService.setCustomizations(cornerstoneCustomizations as Record<string, any>);
      }
    } catch (error) {
      console.warn('Could not load cornerstone customizations:', error);
    }

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
      // Overread mode specific customizations
      ...(isOverreadMode && {
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
      'PanZoomSync',
      'TrackballRotate',
      'WindowLevel',
      'Layout',
      'Crosshairs',
      'MoreTools',
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