import { eventTarget, Types } from '@cornerstonejs/core';
import { Enums, annotation } from '@cornerstonejs/tools';
import { DicomMetadataStore } from '@ohif/core';

import * as CSExtensionEnums from './enums';
import { toolNames } from './initCornerstoneTools';
import { onCompletedCalibrationLine } from './tools/CalibrationLineTool';
import measurementServiceMappingsFactory from './utils/measurementServiceMappings/measurementServiceMappingsFactory';
import getSOPInstanceAttributes from './utils/measurementServiceMappings/utils/getSOPInstanceAttributes';
import {
  setAnnotationLabel,
  triggerAnnotationRenderForViewportIds,
} from '@cornerstonejs/tools/utilities';
import getActiveViewportEnabledElement from './utils/getActiveViewportEnabledElement';

const { CORNERSTONE_3D_TOOLS_SOURCE_NAME, CORNERSTONE_3D_TOOLS_SOURCE_VERSION } = CSExtensionEnums;
const { removeAnnotation } = annotation.state;
const csToolsEvents = Enums.Events;

const initMeasurementService = (
  measurementService,
  displaySetService,
  cornerstoneViewportService,
  customizationService
) => {
  /* Initialization */
  const {
    Length,
    Bidirectional,
    EllipticalROI,
    CircleROI,
    ArrowAnnotate,
    Angle,
    CobbAngle,
    RectangleROI,
    PlanarFreehandROI,
    SplineROI,
    LivewireContour,
    Probe,
    UltrasoundDirectional,
    UltrasoundPleuraBLine,
    SegmentBidirectional,
  } = measurementServiceMappingsFactory(
    measurementService,
    displaySetService,
    cornerstoneViewportService,
    customizationService
  );
  const csTools3DVer1MeasurementSource = measurementService.createSource(
    CORNERSTONE_3D_TOOLS_SOURCE_NAME,
    CORNERSTONE_3D_TOOLS_SOURCE_VERSION
  );

  /* Mappings */
  measurementService.addMapping(
    csTools3DVer1MeasurementSource,
    'Length',
    Length.matchingCriteria,
    Length.toAnnotation,
    Length.toMeasurement
  );

  measurementService.addMapping(
    csTools3DVer1MeasurementSource,
    'Crosshairs',
    Length.matchingCriteria,
    () => {
      return null;
    },
    () => {
      return null;
    }
  );

  measurementService.addMapping(
    csTools3DVer1MeasurementSource,
    'Bidirectional',
    Bidirectional.matchingCriteria,
    Bidirectional.toAnnotation,
    Bidirectional.toMeasurement
  );

  measurementService.addMapping(
    csTools3DVer1MeasurementSource,
    'EllipticalROI',
    EllipticalROI.matchingCriteria,
    EllipticalROI.toAnnotation,
    EllipticalROI.toMeasurement
  );

  measurementService.addMapping(
    csTools3DVer1MeasurementSource,
    'CircleROI',
    CircleROI.matchingCriteria,
    CircleROI.toAnnotation,
    CircleROI.toMeasurement
  );

  measurementService.addMapping(
    csTools3DVer1MeasurementSource,
    'ArrowAnnotate',
    ArrowAnnotate.matchingCriteria,
    ArrowAnnotate.toAnnotation,
    ArrowAnnotate.toMeasurement
  );

  measurementService.addMapping(
    csTools3DVer1MeasurementSource,
    'CobbAngle',
    CobbAngle.matchingCriteria,
    CobbAngle.toAnnotation,
    CobbAngle.toMeasurement
  );

  measurementService.addMapping(
    csTools3DVer1MeasurementSource,
    'Angle',
    Angle.matchingCriteria,
    Angle.toAnnotation,
    Angle.toMeasurement
  );

  measurementService.addMapping(
    csTools3DVer1MeasurementSource,
    'RectangleROI',
    RectangleROI.matchingCriteria,
    RectangleROI.toAnnotation,
    RectangleROI.toMeasurement
  );

  measurementService.addMapping(
    csTools3DVer1MeasurementSource,
    'PlanarFreehandROI',
    PlanarFreehandROI.matchingCriteria,
    PlanarFreehandROI.toAnnotation,
    PlanarFreehandROI.toMeasurement
  );

  measurementService.addMapping(
    csTools3DVer1MeasurementSource,
    'SplineROI',
    SplineROI.matchingCriteria,
    SplineROI.toAnnotation,
    SplineROI.toMeasurement
  );

  // On the UI side, the Calibration Line tool will work almost the same as the
  // Length tool
  measurementService.addMapping(
    csTools3DVer1MeasurementSource,
    'CalibrationLine',
    Length.matchingCriteria,
    Length.toAnnotation,
    Length.toMeasurement
  );

  measurementService.addMapping(
    csTools3DVer1MeasurementSource,
    'LivewireContour',
    LivewireContour.matchingCriteria,
    LivewireContour.toAnnotation,
    LivewireContour.toMeasurement
  );

  measurementService.addMapping(
    csTools3DVer1MeasurementSource,
    'Probe',
    Probe.matchingCriteria,
    Probe.toAnnotation,
    Probe.toMeasurement
  );

  measurementService.addMapping(
    csTools3DVer1MeasurementSource,
    'UltrasoundDirectionalTool',
    UltrasoundDirectional.matchingCriteria,
    UltrasoundDirectional.toAnnotation,
    UltrasoundDirectional.toMeasurement
  );

  measurementService.addMapping(
    csTools3DVer1MeasurementSource,
    'UltrasoundPleuraBLineTool',
    UltrasoundPleuraBLine.matchingCriteria,
    UltrasoundPleuraBLine.toAnnotation,
    UltrasoundPleuraBLine.toMeasurement
  );

  measurementService.addMapping(
    csTools3DVer1MeasurementSource,
    'SegmentBidirectional',
    SegmentBidirectional.matchingCriteria,
    SegmentBidirectional.toAnnotation,
    SegmentBidirectional.toMeasurement
  );

  return csTools3DVer1MeasurementSource;
};

const connectToolsToMeasurementService = ({
  commandsManager,
  servicesManager,
  extensionManager,
}: {
  commandsManager: AppTypes.CommandsManager;
  servicesManager: AppTypes.ServicesManager;
  extensionManager: AppTypes.ExtensionManager;
}) => {
  const {
    measurementService,
    displaySetService,
    cornerstoneViewportService,
    customizationService,
  } = servicesManager.services;
  const csTools3DVer1MeasurementSource = initMeasurementService(
    measurementService,
    displaySetService,
    cornerstoneViewportService,
    customizationService
  );
  connectMeasurementServiceToTools({ servicesManager, commandsManager, extensionManager });
  const { annotationToMeasurement, remove } = csTools3DVer1MeasurementSource;

  //
  function addMeasurement(csToolsEvent) {
    try {
      const annotationAddedEventDetail = csToolsEvent.detail;
      const {
        annotation: { metadata, annotationUID },
      } = annotationAddedEventDetail;
      const { toolName } = metadata;

      if (csToolsEvent.type === completedEvt && toolName === toolNames.CalibrationLine) {
        // show modal to input the measurement (mm)
        onCompletedCalibrationLine(servicesManager, csToolsEvent)
          .then(
            () => {
              console.log('Calibration applied.');
            },
            () => true
          )
          .finally(() => {
            // we don't need the calibration line lingering around, remove the
            // annotation from the display
            removeAnnotation(annotationUID);
            removeMeasurement(csToolsEvent);
            // this will ensure redrawing of annotations
            cornerstoneViewportService.resize();
          });
      } else {
        // To force the measurementUID be the same as the annotationUID
        // Todo: this should be changed when a measurement can include multiple annotations
        // in the future
        annotationAddedEventDetail.uid = annotationUID;
        annotationToMeasurement(toolName, annotationAddedEventDetail);
      }
    } catch (error) {
      console.warn('Failed to add measurement:', error);
    }
  }

  function updateMeasurement(csToolsEvent) {
    try {
      const annotationModifiedEventDetail = csToolsEvent.detail;

      const {
        annotation: { metadata, annotationUID },
      } = annotationModifiedEventDetail;

      // If the measurement hasn't been added, don't modify it
      const measurement = measurementService.getMeasurement(annotationUID);

      if (!measurement) {
        return;
      }
      const { toolName } = metadata;

      annotationModifiedEventDetail.uid = annotationUID;
      // Passing true to indicate this is an update and NOT a annotation (start) completion.
      annotationToMeasurement(toolName, annotationModifiedEventDetail, true);
    } catch (error) {
      console.warn('Failed to update measurement:', error);
    }
  }

  function selectMeasurement(csToolsEvent) {
    try {
      const annotationSelectionEventDetail = csToolsEvent.detail;

      const { added: addedSelectedAnnotationUIDs, removed: removedSelectedAnnotationUIDs } =
        annotationSelectionEventDetail;

      if (removedSelectedAnnotationUIDs) {
        removedSelectedAnnotationUIDs.forEach(annotationUID =>
          measurementService.setMeasurementSelected(annotationUID, false)
        );
      }

      if (addedSelectedAnnotationUIDs) {
        addedSelectedAnnotationUIDs.forEach(annotationUID =>
          measurementService.setMeasurementSelected(annotationUID, true)
        );
      }
    } catch (error) {
      console.warn('Failed to select/unselect measurements:', error);
    }
  }

  /**
   * When csTools fires a removed event, remove the same measurement
   * from the measurement service
   *
   * @param {*} csToolsEvent
   */
  function removeMeasurement(csToolsEvent) {
    try {
      const annotationRemovedEventDetail = csToolsEvent.detail;
      const {
        annotation: { annotationUID },
      } = annotationRemovedEventDetail;
      const measurement = measurementService.getMeasurement(annotationUID);
      if (measurement) {
        remove(annotationUID, annotationRemovedEventDetail);
      }
    } catch (error) {
      console.warn('Failed to remove measurement:', error);
    }
  }

  // on display sets added, check if there are any measurements in measurement service that need to be
  // put into cornerstone tools
  const addedEvt = csToolsEvents.ANNOTATION_ADDED;
  const completedEvt = csToolsEvents.ANNOTATION_COMPLETED;
  const updatedEvt = csToolsEvents.ANNOTATION_MODIFIED;
  const removedEvt = csToolsEvents.ANNOTATION_REMOVED;
  const selectionEvt = csToolsEvents.ANNOTATION_SELECTION_CHANGE;

  eventTarget.addEventListener(addedEvt, addMeasurement);
  eventTarget.addEventListener(completedEvt, addMeasurement);
  eventTarget.addEventListener(updatedEvt, updateMeasurement);
  eventTarget.addEventListener(removedEvt, removeMeasurement);
  eventTarget.addEventListener(selectionEvt, selectMeasurement);

  return csTools3DVer1MeasurementSource;
};

const connectMeasurementServiceToTools = ({
  servicesManager,
  commandsManager,
  extensionManager,
}) => {
  const { measurementService, cornerstoneViewportService, viewportGridService, displaySetService } =
    servicesManager.services;
  const { MEASUREMENT_REMOVED, MEASUREMENTS_CLEARED, MEASUREMENT_UPDATED, RAW_MEASUREMENT_ADDED } =
    measurementService.EVENTS;

  measurementService.subscribe(MEASUREMENTS_CLEARED, ({ measurements }) => {
    if (!Object.keys(measurements).length) {
      return;
    }

    commandsManager.run('startRecordingForAnnotationGroup');
    for (const measurement of Object.values(measurements)) {
      const { uid, source } = measurement;
      if (source.name !== CORNERSTONE_3D_TOOLS_SOURCE_NAME) {
        continue;
      }
      const removedAnnotation = annotation.state.getAnnotation(uid);
      removeAnnotation(uid);
      commandsManager.run('triggerCreateAnnotationMemo', {
        annotation: removedAnnotation,
        FrameOfReferenceUID: removedAnnotation.metadata.FrameOfReferenceUID,
        options: { deleting: true },
      });
    }
    commandsManager.run('endRecordingForAnnotationGroup');

    // trigger a render
    cornerstoneViewportService.getRenderingEngine().render();
  });

  measurementService.subscribe(
    MEASUREMENT_UPDATED,
    ({ source, measurement, notYetUpdatedAtSource }) => {
      if (!source) {
        return;
      }

      if (source.name !== CORNERSTONE_3D_TOOLS_SOURCE_NAME) {
        return;
      }

      if (notYetUpdatedAtSource === false) {
        // This event was fired by cornerstone telling the measurement service to sync.
        // Already in sync.
        return;
      }

      const { uid, label, isLocked, isVisible } = measurement;
      const sourceAnnotation = annotation.state.getAnnotation(uid);
      const { data, metadata } = sourceAnnotation;

      if (!data) {
        return;
      }

      if (data.label !== label) {
        const element = getActiveViewportEnabledElement(viewportGridService)?.viewport.element;
        setAnnotationLabel(sourceAnnotation, element, label);
      }

      // update the isLocked state
      annotation.locking.setAnnotationLocked(uid, isLocked);

      // update the isVisible state
      annotation.visibility.setAnnotationVisibility(uid, isVisible);

      // annotation.config.style.setAnnotationStyles(uid, {
      //   color: `rgb(${color[0]}, ${color[1]}, ${color[2]})`,
      // });

      // I don't like this but will fix later
      const renderingEngine =
        cornerstoneViewportService.getRenderingEngine() as Types.IRenderingEngine;
      // Note: We could do a better job by triggering the render on the
      // viewport itself, but the removeAnnotation does not include that info...
      const viewportIds = renderingEngine.getViewports().map(viewport => viewport.id);
      triggerAnnotationRenderForViewportIds(viewportIds);
    }
  );

  measurementService.subscribe(
    RAW_MEASUREMENT_ADDED,
    ({ source, measurement, data, dataSource }) => {
      if (source.name !== CORNERSTONE_3D_TOOLS_SOURCE_NAME) {
        return;
      }

      const { referenceSeriesUID, referenceStudyUID, SOPInstanceUID, metadata } = measurement;

      const instance = DicomMetadataStore.getInstance(
        referenceStudyUID,
        referenceSeriesUID,
        SOPInstanceUID
      );

      let imageId;
      let frameNumber = 1;

      if (measurement?.metadata?.referencedImageId) {
        imageId = measurement.metadata.referencedImageId;
        frameNumber = getSOPInstanceAttributes(measurement.metadata.referencedImageId).frameNumber;
      } else if (instance) {
        imageId = dataSource.getImageIdsForInstance({ instance });
      }

      /**
       * This annotation is used by the cornerstone viewport.
       * This is not the read-only annotation rendered by the SR viewport.
       */
      const annotationManager = annotation.state.getAnnotationManager();
      const newAnnotation = {
        annotationUID: measurement.uid,
        // Not used in CS3D but stored in the CS3D state so that saving
        // can apply the predecessor consistently.
        predecessorImageId: measurement?.predecessorImageId,
        highlighted: false,
        isLocked: false,
        // This is used to force a re-render of the annotation to
        // re-calculate cached stats since sometimes in SR we
        // get empty cached stats
        invalidated: true,
        metadata: {
          ...metadata,
          toolName: measurement.toolName,
          FrameOfReferenceUID: measurement.FrameOfReferenceUID,
          referencedImageId: imageId,
        },
        data: {
          /**
           * Don't remove this destructuring of data here.
           * This is used to pass annotation specific data forward e.g. contour
           */
          ...(data.annotation.data || {}),
          text: data.annotation.data?.text,
          handles: data.annotation.data?.handles || measurement.data?.handles || {},
          cachedStats: data.annotation.data?.cachedStats || measurement.data?.cachedStats || {},
          label: data.annotation.data?.label || measurement.label,
          frameNumber,
        },
      };

      // Check what annotations exist before adding
      const allAnnotationsBefore = annotationManager.getAllAnnotations();

      // Get the enabled element for the viewport that should display this annotation
      const { cornerstoneViewportService } = servicesManager.services;
      const renderingEngine = cornerstoneViewportService.getRenderingEngine();
      const viewports = renderingEngine.getViewports();

      // Find the viewport that should display this annotation
      let targetViewport = null;
      let targetElement = null;

      // First, try to find a viewport that matches the annotation's frame of reference
      if (newAnnotation.metadata.FrameOfReferenceUID) {
        for (const viewport of viewports) {
          const viewportFrameOfRef = viewport.getFrameOfReferenceUID();
          if (viewportFrameOfRef === newAnnotation.metadata.FrameOfReferenceUID) {
            targetViewport = viewport;
            targetElement = viewport.element;
            break;
          }
        }
      }

      // If no frame of reference match, try to find a viewport that displays the referenced image
      if (!targetViewport && newAnnotation.metadata.referencedImageId) {
        for (const viewport of viewports) {
          try {
            const currentImageId = viewport.getCurrentImageId?.();
            if (currentImageId === newAnnotation.metadata.referencedImageId) {
              targetViewport = viewport;
              targetElement = viewport.element;
              break;
            }
          } catch (err) {
            // Skip viewports that don't support getCurrentImageId
          }
        }
      }

      // If still no match, use the first available viewport (fallback)
      if (!targetViewport && viewports.length > 0) {
        targetViewport = viewports[0];
        targetElement = viewports[0].element;
      }

      if (targetElement) {
        // Add the annotation to the specific viewport's enabled element
        annotationManager.addAnnotation(newAnnotation, targetElement);

        // Also ensure the annotation is properly registered with the tool for this viewport
        try {
          const { toolGroupService } = servicesManager.services;
          const toolGroup = toolGroupService.getToolGroupForViewport(targetViewport.id);
          if (toolGroup) {

            // Force the tool to recognize the annotation by ensuring it's in passive mode
            const toolName = newAnnotation.metadata.toolName;
            const toolConfig = toolGroup.getToolConfiguration(toolName);
            if (toolConfig) {

              // Ensure the tool is at least in passive mode so it can render annotations
              const currentMode = toolGroup.getToolOptions(toolName)?.mode;
              if (currentMode !== 'Active' && currentMode !== 'Passive') {
                toolGroup.setToolPassive(toolName);
              }
            }

            // Force the annotation to be visible in this viewport
            try {
              const isVisible = annotation.visibility.isAnnotationVisible(newAnnotation.annotationUID);
              if (!isVisible) {
                annotation.visibility.setAnnotationVisibility(newAnnotation.annotationUID, true);
              }
            } catch (visErr) {
              console.warn('🔍 DEBUG: Could not set annotation visibility:', visErr);
            }
          }
        } catch (toolErr) {
          console.warn('🔍 DEBUG: Could not register annotation with tool group:', toolErr);
        }
      } else {
        annotationManager.addAnnotation(newAnnotation);
      }

      // Check what annotations exist after adding
      const allAnnotationsAfter = annotationManager.getAllAnnotations();

      // Verify the annotation was added with the correct UID
      const addedAnnotation = annotationManager.getAnnotation(measurement.uid);

      // Try to find the annotation by searching through all annotations
      let foundAnnotation = null;
      Object.keys(allAnnotationsAfter).forEach(key => {
        const annotation = allAnnotationsAfter[key];
        if (annotation.annotationUID === measurement.uid) {
          foundAnnotation = annotation;
        }
      });

      if (!foundAnnotation) {
        console.warn('🔍 DEBUG: Could not find annotation with correct UID in annotation manager');
      }
      // Trigger the annotation memo creation with the correct element
      if (targetElement) {
        commandsManager.run('triggerCreateAnnotationMemo', {
          annotation: newAnnotation,
          FrameOfReferenceUID: newAnnotation.metadata.FrameOfReferenceUID,
          options: { newAnnotation: true },
        });

        // Force a render of the target viewport
        if (targetViewport && targetViewport.render) {
          targetViewport.render();
        }

        // Additional: Force the tool to render its annotations
        try {
          const { toolGroupService } = servicesManager.services;
          const toolGroup = toolGroupService.getToolGroupForViewport(targetViewport.id);
          if (toolGroup) {
            const toolName = newAnnotation.metadata.toolName;

            // Trigger annotation rendering for this specific viewport
            const viewportIds = [targetViewport.id];
            triggerAnnotationRenderForViewportIds(viewportIds);
          }
        } catch (toolRenderErr) {
          console.warn('🔍 DEBUG: Could not force tool render:', toolRenderErr);
        }
      } else {
        commandsManager.run('triggerCreateAnnotationMemo', {
          annotation: newAnnotation,
          FrameOfReferenceUID: newAnnotation.metadata.FrameOfReferenceUID,
          options: { newAnnotation: true },
        });
      }
    }
  );

  measurementService.subscribe(
    MEASUREMENT_REMOVED,
    ({ source, measurement: removedMeasurementId }) => {
      if (source?.name && source.name !== CORNERSTONE_3D_TOOLS_SOURCE_NAME) {
        return;
      }
      const removedAnnotation = annotation.state.getAnnotation(removedMeasurementId);
      removeAnnotation(removedMeasurementId);
      // Ensure `removedAnnotation` is available before triggering the memo,
      // as it can be undefined during an undo operation
      if (removedAnnotation) {
        commandsManager.run('triggerCreateAnnotationMemo', {
          annotation: removedAnnotation,
          FrameOfReferenceUID: removedAnnotation.metadata.FrameOfReferenceUID,
          options: { deleting: true },
        });
      }
      const renderingEngine = cornerstoneViewportService.getRenderingEngine();
      // Note: We could do a better job by triggering the render on the
      // viewport itself, but the removeAnnotation does not include that info...
      renderingEngine.render();
    }
  );
};

export {
  initMeasurementService,
  connectToolsToMeasurementService,
  connectMeasurementServiceToTools,
};
