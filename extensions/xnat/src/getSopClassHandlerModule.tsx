import { utils, classes } from '@ohif/core';
import i18n from '@ohif/i18n';
import { id } from './id';
import getDisplaySetMessages from './getDisplaySetMessages';
import getDisplaySetsFromUnsupportedSeries from './getDisplaySetsFromUnsupportedSeries';

const {
  isImage,
  sopClassDictionary,
  isDisplaySetReconstructable,
  sortStudyInstances,
  instancesSortCriteria,
} = utils;
const { ImageSet } = classes;

const DEFAULT_VOLUME_LOADER_SCHEME = 'cornerstoneStreamingImageVolume';
const DYNAMIC_VOLUME_LOADER_SCHEME = 'cornerstoneStreamingDynamicImageVolume';
const sopClassHandlerName = 'xnatSopClassHandler';

interface XNATSeriesMetadata {
  [studyInstanceUID: string]: {
    PatientID?: string;
    PatientName?: string;
    StudyDate?: string;
    StudyTime?: string;
    StudyDescription?: string;
    series: Array<{
      SeriesInstanceUID: string;
      SeriesDescription?: string;
      SeriesNumber?: string;
      SeriesDate?: string;
      SeriesTime?: string;
      Modality?: string;
      StudyInstanceUID: string;
      PatientID?: string;
      PatientName?: string;
      StudyDate?: string;
      StudyTime?: string;
      StudyDescription?: string;
    }>;
  };
}

interface ServicesAppContext {
  xnatSeriesMetadata?: XNATSeriesMetadata;
  [key: string]: any;
}

interface ServicesManager {
  services: {
    AppContext?: ServicesAppContext;
    [key: string]: any;
  };
  getActiveDataSource: () => Array<any>;
}

interface ExtensionManager {
  getModuleEntry: (moduleName: string) => any;
  getActiveDataSource: () => Array<any>;
  [key: string]: any;
}

interface AppConfig {
  [key: string]: any;
}

interface AppContextType {
  extensionManager?: ExtensionManager;
  appConfig?: AppConfig;
  servicesManager?: ServicesManager;
  [key: string]: any;
}

let appContext: AppContextType = {};

const getDynamicVolumeInfo = instances => {
  const { extensionManager } = appContext;

  if (!extensionManager) {
    console.warn('getDynamicVolumeInfo: extensionManager is not available');
    return { isDynamicVolume: false, timePoints: [], getRegularTimePointData: () => [] };
  }

  const imageIds = instances.map(({ imageId }) => imageId);
  const volumeLoaderUtility = extensionManager.getModuleEntry(
    '@ohif/extension-cornerstone.utilityModule.volumeLoader'
  );

  if (!volumeLoaderUtility || !volumeLoaderUtility.exports || !volumeLoaderUtility.exports.getDynamicVolumeInfo) {
    console.warn('getDynamicVolumeInfo: cornerstone.utilityModule.volumeLoader or its getDynamicVolumeInfo export is not available.');
    return { isDynamicVolume: false, timePoints: [], getRegularTimePointData: () => [] };
  }
  const { getDynamicVolumeInfo: csGetDynamicVolumeInfo } = volumeLoaderUtility.exports;
  return csGetDynamicVolumeInfo(imageIds);
};

const isMultiFrame = instance => {
  return instance.NumberOfFrames > 1;
};

const isSingleImageModality = modality => {
  return modality === 'CR' || modality === 'MG' || modality === 'DX';
};

function getDisplaySetInfo(instances) {
  const dynamicVolumeInfo = getDynamicVolumeInfo(instances);
  const { appConfig } = appContext;

  if (dynamicVolumeInfo.isDynamicVolume) {
    return {
      isDynamicVolume: true,
      value: false,
      averageSpacingBetweenFrames: null,
      dynamicVolumeInfo,
    };
  }

  const reconstructableResult = isDisplaySetReconstructable(instances, appConfig);

  return {
    isDynamicVolume: false,
    value: reconstructableResult.value,
    averageSpacingBetweenFrames: reconstructableResult.averageSpacingBetweenFrames,
    dynamicVolumeInfo,
  };
}

const makeDisplaySet = instances => {
  if (instances && instances.length > 0 && instances[0] && instances[0].InstanceNumber !== undefined) {
    sortStudyInstances(instances);
  } else if (instances && instances.length > 0 && instances[0] && instances[0].AcquisitionNumber !== undefined) {
    instances.sort((a,b) => (parseInt(a.AcquisitionNumber) || 0) - (parseInt(b.AcquisitionNumber) || 0) || (parseInt(a.InstanceNumber) || 0) - (parseInt(b.InstanceNumber) || 0));
  }

  const instance = instances[0];

  const imageSet = new ImageSet(instances);

  const { extensionManager } = appContext;
  let dataSource;
  if (extensionManager && typeof extensionManager.getActiveDataSource === 'function') {
    const activeDataSources = extensionManager.getActiveDataSource();
    if (activeDataSources && activeDataSources.length > 0) {
      dataSource = activeDataSources[0];
    }
  }

  if (!dataSource) {
    console.warn('XNAT SOPClassHandler - makeDisplaySet: Unable to get active dataSource from extensionManager.');
  }

  const {
    isDynamicVolume,
    value: isReconstructable,
    averageSpacingBetweenFrames,
    dynamicVolumeInfo,
  } = getDisplaySetInfo(instances);

  const volumeLoaderSchema = isDynamicVolume
    ? DYNAMIC_VOLUME_LOADER_SCHEME
    : DEFAULT_VOLUME_LOADER_SCHEME;

  const messages = getDisplaySetMessages(instances, isReconstructable, isDynamicVolume);

  let displaySetImageId;
  let thumbnailInstance = instances[Math.floor(instances.length / 2)];

  if (dataSource && typeof dataSource.getImageIdsForDisplaySet === 'function') {
    const allImageIdsInDisplaySet = dataSource.getImageIdsForDisplaySet(imageSet);
    displaySetImageId = allImageIdsInDisplaySet[Math.floor(allImageIdsInDisplaySet.length / 2)];

    if (isDynamicVolume && dynamicVolumeInfo.timePoints && dynamicVolumeInfo.timePoints.length > 0) {
      const timePoints = dynamicVolumeInfo.timePoints;
      const middleTimePointIndex = Math.floor(timePoints.length / 2);
      const middleTimePointImageIds = timePoints[middleTimePointIndex];
      if (middleTimePointImageIds && middleTimePointImageIds.length > 0) {
        displaySetImageId = middleTimePointImageIds[Math.floor(middleTimePointImageIds.length / 2)];
        thumbnailInstance = instances.find(inst => inst.imageId === displaySetImageId) || thumbnailInstance;
      }
    }
  } else {
    displaySetImageId = (thumbnailInstance && thumbnailInstance.imageId) || (instance && instance.imageId);
  }

  const StudyInstanceUID = instance.StudyInstanceUID;
  const SeriesInstanceUID = instance.SeriesInstanceUID;
  let seriesMetadata = null;
  let studyMetadata = null;

  // Construct imageIds array
  const imageIds = instances.map(inst => inst.imageId).filter(id => id);

  if (appContext.servicesManager && appContext.servicesManager.services) {
    const AppContextService = appContext.servicesManager.services.AppContext;
    if (AppContextService && AppContextService.xnatSeriesMetadata) {
      studyMetadata = AppContextService.xnatSeriesMetadata[StudyInstanceUID];
      if (studyMetadata && Array.isArray(studyMetadata.series)) {
        seriesMetadata = studyMetadata.series.find(
          s => s.SeriesInstanceUID === SeriesInstanceUID
        );
      }
    }
  }

  const initialAttributes = {
    SeriesDate: (seriesMetadata?.SeriesDate) || instance?.SeriesDate,
    SeriesTime: (seriesMetadata?.SeriesTime) || instance?.SeriesTime,
    SeriesInstanceUID: instance?.SeriesInstanceUID,
    StudyInstanceUID: instance?.StudyInstanceUID,
    SeriesNumber: (seriesMetadata?.SeriesNumber) || instance?.SeriesNumber || 0,
    SeriesDescription: (seriesMetadata?.SeriesDescription) || instance?.SeriesDescription || '',
    Modality: (seriesMetadata?.Modality) || instance?.Modality,
    PatientID: (seriesMetadata?.PatientID) || (studyMetadata?.PatientID) || instance?.PatientID,
    PatientName: (seriesMetadata?.PatientName) || (studyMetadata?.PatientName) || instance?.PatientName,
    StudyDate: (seriesMetadata?.StudyDate) || (studyMetadata?.StudyDate) || instance?.StudyDate,
    StudyTime: (seriesMetadata?.StudyTime) || (studyMetadata?.StudyTime) || instance?.StudyTime,
    StudyDescription: (seriesMetadata?.StudyDescription) || (studyMetadata?.StudyDescription) || instance?.StudyDescription || 'No Description',
    volumeLoaderSchema,
    displaySetInstanceUID: imageSet.uid,
    FrameRate: instance?.FrameTime,
    SOPClassUID: instance?.SOPClassUID,
    isMultiFrame: isMultiFrame(instance),
    countIcon: isReconstructable ? 'icon-mpr' : undefined,
    numImageFrames: instances.length,
    SOPClassHandlerId: `${id}.sopClassHandlerModule.${sopClassHandlerName}`,
    isReconstructable,
    messages,
    averageSpacingBetweenFrames: averageSpacingBetweenFrames || null,
    isDynamicVolume,
    dynamicVolumeInfo,
    imageIds,
    getThumbnailSrc: dataSource && typeof dataSource.retrieve?.getGetThumbnailSrc === 'function'
      ? dataSource.retrieve.getGetThumbnailSrc(thumbnailInstance, displaySetImageId)
      : undefined,
    supportsWindowLevel: true,
    FrameOfReferenceUID: instance?.FrameOfReferenceUID,
    label: '',
  };

  const labelSeriesDesc = initialAttributes.SeriesDescription;
  const labelSeriesNumber = initialAttributes.SeriesNumber;
  const labelModality = initialAttributes.Modality;
  initialAttributes.label = labelSeriesDesc || `${i18n.t('Series')} ${labelSeriesNumber} - ${labelModality ? i18n.t(labelModality) : ''}`;

  imageSet.setAttributes(initialAttributes);

  imageSet.sortBy(instancesSortCriteria.default);

  return imageSet;
};

function getSopClassUids(instances) {
  const uniqueSopClassUidsInSeries = new Set();
  instances.forEach(instance => {
    uniqueSopClassUidsInSeries.add(instance.SOPClassUID);
  });
  const sopClassUids = Array.from(uniqueSopClassUidsInSeries);

  return sopClassUids;
}

/**
 * Basic SOPClassHandler:
 * - For all Image types that are stackable, create
 *   a displaySet with a stack of images
 *
 * @param {object[]} instances The list of instances for the series
 * @returns {Array} The list of display sets created for the given series object
 */
function getDisplaySetsFromSeries(instances) {
  // If the series has no instances, stop here
  if (!instances || !instances.length) {
    throw new Error('No instances were provided');
  }

  const displaySets = [];
  const sopClassUids = getSopClassUids(instances);

  // Search through the instances (InstanceMetadata object) of this series
  // Split Multi-frame instances and Single-image modalities
  // into their own specific display sets. Place the rest of each
  // series into another display set.
  const stackableInstances = [];
  instances.forEach(instance => {
    // All imaging modalities must have a valid value for sopClassUid (x00080016) or rows (x00280010)
    if (!isImage(instance.SOPClassUID) && !instance.Rows) {
      return;
    }

    let displaySet;
    if (isMultiFrame(instance)) {
      displaySet = makeDisplaySet([instance]);
      displaySet.setAttributes({
        sopClassUids,
        numImageFrames: instance.NumberOfFrames,
        instanceNumber: instance.InstanceNumber,
        acquisitionDatetime: instance.AcquisitionDateTime,
      });
      displaySets.push(displaySet);
    } else if (isSingleImageModality(instance.Modality)) {
      displaySet = makeDisplaySet([instance]);
      displaySet.setAttributes({
        sopClassUids,
        instanceNumber: instance.InstanceNumber,
        acquisitionDatetime: instance.AcquisitionDateTime,
      });
      displaySets.push(displaySet);
    } else {
      stackableInstances.push(instance);
    }
  });

  if (stackableInstances.length) {
    const displaySet = makeDisplaySet(stackableInstances);
    displaySet.setAttribute('studyInstanceUid', instances[0].StudyInstanceUID);
    displaySet.setAttributes({
      sopClassUids,
    });
    displaySets.push(displaySet);
  }

  return displaySets;
}

const sopClassUids = [
  sopClassDictionary.ComputedRadiographyImageStorage,
  sopClassDictionary.DigitalXRayImageStorageForPresentation,
  sopClassDictionary.DigitalXRayImageStorageForProcessing,
  sopClassDictionary.DigitalMammographyXRayImageStorageForPresentation,
  sopClassDictionary.DigitalMammographyXRayImageStorageForProcessing,
  sopClassDictionary.DigitalIntraOralXRayImageStorageForPresentation,
  sopClassDictionary.DigitalIntraOralXRayImageStorageForProcessing,
  sopClassDictionary.CTImageStorage,
  sopClassDictionary.EnhancedCTImageStorage,
  sopClassDictionary.LegacyConvertedEnhancedCTImageStorage,
  sopClassDictionary.UltrasoundMultiframeImageStorage,
  sopClassDictionary.MRImageStorage,
  sopClassDictionary.EnhancedMRImageStorage,
  sopClassDictionary.EnhancedMRColorImageStorage,
  sopClassDictionary.LegacyConvertedEnhancedMRImageStorage,
  sopClassDictionary.UltrasoundImageStorage,
  sopClassDictionary.UltrasoundImageStorageRET,
  sopClassDictionary.SecondaryCaptureImageStorage,
  sopClassDictionary.MultiframeSingleBitSecondaryCaptureImageStorage,
  sopClassDictionary.MultiframeGrayscaleByteSecondaryCaptureImageStorage,
  sopClassDictionary.MultiframeGrayscaleWordSecondaryCaptureImageStorage,
  sopClassDictionary.MultiframeTrueColorSecondaryCaptureImageStorage,
  sopClassDictionary.XRayAngiographicImageStorage,
  sopClassDictionary.EnhancedXAImageStorage,
  sopClassDictionary.XRayRadiofluoroscopicImageStorage,
  sopClassDictionary.EnhancedXRFImageStorage,
  sopClassDictionary.XRay3DAngiographicImageStorage,
  sopClassDictionary.XRay3DCraniofacialImageStorage,
  sopClassDictionary.BreastTomosynthesisImageStorage,
  sopClassDictionary.BreastProjectionXRayImageStorageForPresentation,
  sopClassDictionary.BreastProjectionXRayImageStorageForProcessing,
  sopClassDictionary.IntravascularOpticalCoherenceTomographyImageStorageForPresentation,
  sopClassDictionary.IntravascularOpticalCoherenceTomographyImageStorageForProcessing,
  sopClassDictionary.OphthalmicPhotography8BitImageStorage,
  sopClassDictionary.OphthalmicPhotography16BitImageStorage,
  sopClassDictionary.OphthalmicTomographyImageStorage,
  sopClassDictionary.VLWholeSlideMicroscopyImageStorage,
  sopClassDictionary.VLSlideCoordinatesMicroscopicImageStorage,
  sopClassDictionary.VLPhotographicImageStorage,
  sopClassDictionary.VideoEndoscopicImageStorage,
  sopClassDictionary.VideoMicroscopicImageStorage,
  sopClassDictionary.VideoPhotographicImageStorage,
  sopClassDictionary.NuclearMedicineImageStorage,
  sopClassDictionary.ParametricMapStorage,
  // Other SOP Classes that are not images but we are going to list them here
  // so we can discover them and show them in the series list
  sopClassDictionary.RTStructureSetStorage,
  sopClassDictionary.RTDoseStorage,
  sopClassDictionary.RTPlanStorage,
  sopClassDictionary.RTIonPlanStorage,
  sopClassDictionary.RTIonBeamsTreatmentRecordStorage,
  sopClassDictionary.RTBrachyTreatmentRecordStorage,
  sopClassDictionary.RTTreatmentSummaryRecordStorage,
  sopClassDictionary.ComprehensiveSRStorage,
  sopClassDictionary.Comprehensive3DSRStorage,
  sopClassDictionary.ExtensibleSRStorage,
  sopClassDictionary.LegacyEnhancedSRStorage,
  sopClassDictionary.EnhancedSRStorage,
  sopClassDictionary.PDFStorage,
  sopClassDictionary.SegmentationStorage,
  // to be added in future
  // sopClassDictionary.SurfaceSegmentationStorage,
];

export default function getSopClassHandlerModule(appContextParam: AppContextType) {
  appContext = appContextParam;

  return [{
      name: sopClassHandlerName,
      sopClassUids,
      getDisplaySetsFromSeries,
    },
    {
      name: 'not-supported-display-sets-handler',
      sopClassUids: [],
      getDisplaySetsFromSeries: getDisplaySetsFromUnsupportedSeries,
    },
  ];
} 