import { DicomMetadataStore, classes } from '@ohif/core';
import { calculateSUVScalingFactors } from '@cornerstonejs/calculate-suv';
import { utilities } from '@cornerstonejs/core';
import {
  addTool,
  RectangleROIStartEndThresholdTool,
} from '@cornerstonejs/tools';
import getPTImageIdInstanceMetadata from './getPTImageIdInstanceMetadata';
import colormaps from './utils/colormaps';
import measurementServiceMappingsFactory from './utils/measurementServiceMappings/measurementServiceMappingsFactory';
import * as cornerstoneTools from '@cornerstonejs/tools';

const { registerColormap } = utilities.colormap;
const metadataProvider = classes.MetadataProvider;
const CORNERSTONE_3D_TOOLS_SOURCE_NAME = 'Cornerstone3DTools';
const CORNERSTONE_3D_TOOLS_SOURCE_VERSION = '0.1';
/**
 *
 * @param {Object} servicesManager
 * @param {Object} configuration
 */
export default function init({ servicesManager, configuration = {} }): void {
  const {
    stateSyncService,
    measurementService,
    displaySetService,
    cornerstoneViewportService,
  } = servicesManager.services;
  // Add
  DicomMetadataStore.subscribe(
    DicomMetadataStore.EVENTS.INSTANCES_ADDED,
    handlePETImageMetadata
  );

  // If the metadata for PET has changed by the user (e.g. manually changing the PatientWeight)
  // we need to recalculate the SUV Scaling Factors
  DicomMetadataStore.subscribe(
    DicomMetadataStore.EVENTS.SERIES_UPDATED,
    handlePETImageMetadata
  );

  // viewportGridStore is a sync state which stores the entire
  // ViewportGridService getState, by the keys `<activeStudyUID>:<protocolId>:<stageIndex>`
  // Used to recover manual changes to the layout of a stage.
  stateSyncService.register('viewportGridStore', { clearOnModeExit: true });

  // displaySetSelectorMap stores a map from
  // `<activeStudyUID>:<displaySetSelectorId>:<matchOffset>` to
  // a displaySetInstanceUID, used to display named display sets in
  // specific spots within a hanging protocol and be able to remember what the
  // user did with those named spots between stages and protocols.
  stateSyncService.register('displaySetSelectorMap', { clearOnModeExit: true });

  // Stores a map from `<activeStudyUID>:${protocolId}` to the getHPInfo results
  // in order to recover the correct stage when returning to a Hanging Protocol.
  stateSyncService.register('hangingProtocolStageIndexMap', {
    clearOnModeExit: true,
  });

  // Stores a map from the to be applied hanging protocols `<activeStudyUID>:<protocolId>`
  // to the previously applied hanging protolStageIndexMap key, in order to toggle
  // off the applied protocol and remember the old state.
  stateSyncService.register('toggleHangingProtocol', { clearOnModeExit: true });

  // Stores the viewports by `rows-cols` position so that when the layout
  // changes numRows and numCols, the viewports can be remembers and then replaced
  // afterwards.
  stateSyncService.register('viewportsByPosition', { clearOnModeExit: true });

  const labelmapRepresentation = cornerstoneTools.Enums.SegmentationRepresentations.Labelmap;

  cornerstoneTools.segmentation.config.setGlobalRepresentationConfig(labelmapRepresentation, {
    fillAlpha: 1,
    fillAlphaInactive: 0.2,
    outlineOpacity: 0,
    outlineOpacityInactive: 0.65,
  });

  // addTool(RectangleROIStartEndThresholdTool);

  // const { RectangleROIStartEndThreshold } = measurementServiceMappingsFactory(
  //   measurementService,
  //   displaySetService,
  //   cornerstoneViewportService
  // );

  // const csTools3DVer1MeasurementSource = measurementService.getSource(
  //   CORNERSTONE_3D_TOOLS_SOURCE_NAME,
  //   CORNERSTONE_3D_TOOLS_SOURCE_VERSION
  // );
  // console.log(csTools3DVer1MeasurementSource);
  // measurementService.addMapping(
  //   csTools3DVer1MeasurementSource,
  //   'RectangleROIStartEndThreshold',
  //   RectangleROIStartEndThreshold.matchingCriteria,
  //   RectangleROIStartEndThreshold.toAnnotation,
  //   RectangleROIStartEndThreshold.toMeasurement
  // );

  colormaps.forEach(registerColormap);
}

const handlePETImageMetadata = ({ SeriesInstanceUID, StudyInstanceUID }) => {
  const { instances } = DicomMetadataStore.getSeries(
    StudyInstanceUID,
    SeriesInstanceUID
  );

  const modality = instances[0].Modality;
  if (modality !== 'PT') {
    return;
  }
  const imageIds = instances.map(instance => instance.imageId);
  const instanceMetadataArray = [];
  imageIds.forEach(imageId => {
    const instanceMetadata = getPTImageIdInstanceMetadata(imageId);
    if (instanceMetadata) {
      instanceMetadataArray.push(instanceMetadata);
    }
  });

  if (!instanceMetadataArray.length) {
    return;
  }

  // try except block to prevent errors when the metadata is not correct
  let suvScalingFactors;
  try {
    suvScalingFactors = calculateSUVScalingFactors(instanceMetadataArray);
  } catch (error) {
    console.log(error);
  }

  if (!suvScalingFactors) {
    return;
  }

  instanceMetadataArray.forEach((instanceMetadata, index) => {
    metadataProvider.addCustomMetadata(
      imageIds[index],
      'scalingModule',
      suvScalingFactors[index]
    );
  });
};
