import queryString from 'query-string';
import dicomParser from 'dicom-parser';
import { utilities } from '@cornerstonejs/core';
import { imageIdToURI } from '../utils';
import DicomMetadataStore from '../services/DicomMetadataStore';
import fetchPaletteColorLookupTableData from '../utils/metadataProvider/fetchPaletteColorLookupTableData';
import toNumber from '../utils/toNumber';
import combineFrameInstance from '../utils/combineFrameInstance';
import formatPN from '../utils/formatPN';
const { calibratedPixelSpacingMetadataProvider, getPixelSpacingInformation } = utilities;

class MetadataProvider {
  private readonly imageURIToUIDs: Map<string, any> = new Map();
  // Can be used to store custom metadata for a specific type.
  // For instance, the scaling metadata for PET can be stored here
  // as type "scalingModule"
  private readonly customMetadata: Map<string, any> = new Map();

  addImageIdToUIDs(imageId, uids) {
    if (!imageId) {
      throw new Error('MetadataProvider::Empty imageId');
    }

    // This method is a fallback for when you don't have WADO-URI or WADO-RS.
    // You can add instances fetched by any method by calling addInstance, and hook an imageId to point at it here.
    // An example would be dicom hosted at some random site.
    const imageURI = imageIdToURI(imageId);
    this.imageURIToUIDs.set(imageURI, uids);
  }

  addCustomMetadata(imageId, type, metadata) {
    const imageURI = imageIdToURI(imageId);
    if (!this.customMetadata.has(type)) {
      this.customMetadata.set(type, {});
    }

    this.customMetadata.get(type)[imageURI] = metadata;
  }

  _getInstance(imageId) {
    if (!imageId) {
      throw new Error('MetadataProvider::Empty imageId');
    }

    const uids = this.getUIDsFromImageID(imageId);

    if (!uids) {
      return;
    }

    const { StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID, frameNumber } = uids;

    const instance = DicomMetadataStore.getInstance(
      StudyInstanceUID,
      SeriesInstanceUID,
      SOPInstanceUID
    );

    if (!instance) {
      return;
    }

    return (frameNumber && combineFrameInstance(frameNumber, instance)) || instance;
  }

  get(query, imageId, options = { fallback: false }) {
    if (Array.isArray(imageId)) {
      return;
    }
    const instance = this._getInstance(imageId);

    if (query === INSTANCE) {
      return instance;
    }

    // check inside custom metadata
    if (this.customMetadata.has(query)) {
      const customMetadata = this.customMetadata.get(query);
      const imageURI = imageIdToURI(imageId);
      if (customMetadata[imageURI]) {
        return customMetadata[imageURI];
      }
    }

    return this.getTagFromInstance(query, instance, options);
  }

  getTag(query, imageId, options) {
    return this.get(query, imageId, options);
  }

  getInstance(imageId) {
    return this.get(INSTANCE, imageId);
  }

  getTagFromInstance(naturalizedTagOrWADOImageLoaderTag, instance, options = { fallback: false }) {
    if (!instance) {
      return;
    }

    // If its a naturalized dcmjs tag present on the instance, return.
    if (instance[naturalizedTagOrWADOImageLoaderTag]) {
      return instance[naturalizedTagOrWADOImageLoaderTag];
    }

    // Maybe its a legacy dicomImageLoader tag then:
    return this._getCornerstoneDICOMImageLoaderTag(naturalizedTagOrWADOImageLoaderTag, instance);
  }

  /**
   * Adds a new handler for the given tag.  The handler will be provided an
   * instance object that it can read values from.
   */
  public addHandler(wadoImageLoaderTag: string, handler) {
    WADO_IMAGE_LOADER[wadoImageLoaderTag] = handler;
  }

  _getCornerstoneDICOMImageLoaderTag(wadoImageLoaderTag, instance) {
    let metadata = WADO_IMAGE_LOADER[wadoImageLoaderTag]?.(instance);
    if (metadata) {
      return metadata;
    }

    switch (wadoImageLoaderTag) {
      case WADO_IMAGE_LOADER_TAGS.GENERAL_SERIES_MODULE:
        const { SeriesDate, SeriesTime } = instance;

        let seriesDate;
        let seriesTime;

        if (SeriesDate) {
          seriesDate = dicomParser.parseDA(SeriesDate);
        }

        if (SeriesTime) {
          seriesTime = dicomParser.parseTM(SeriesTime);
        }

        metadata = {
          modality: instance.Modality,
          seriesInstanceUID: instance.SeriesInstanceUID,
          seriesNumber: toNumber(instance.SeriesNumber),
          studyInstanceUID: instance.StudyInstanceUID,
          seriesDate,
          seriesTime,
        };
        break;
      case WADO_IMAGE_LOADER_TAGS.PATIENT_STUDY_MODULE:
        metadata = {
          patientAge: toNumber(instance.PatientAge),
          patientSize: toNumber(instance.PatientSize),
          patientWeight: toNumber(instance.PatientWeight),
        };
        break;
      case WADO_IMAGE_LOADER_TAGS.PATIENT_DEMOGRAPHIC_MODULE:
        metadata = {
          patientSex: instance.PatientSex,
        };
        break;
      case WADO_IMAGE_LOADER_TAGS.IMAGE_PIXEL_MODULE:
        metadata = {
          samplesPerPixel: toNumber(instance.SamplesPerPixel),
          photometricInterpretation: instance.PhotometricInterpretation,
          rows: toNumber(instance.Rows),
          columns: toNumber(instance.Columns),
          bitsAllocated: toNumber(instance.BitsAllocated),
          bitsStored: toNumber(instance.BitsStored),
          highBit: toNumber(instance.HighBit),
          pixelRepresentation: toNumber(instance.PixelRepresentation),
          planarConfiguration: toNumber(instance.PlanarConfiguration),
          pixelAspectRatio: toNumber(instance.PixelAspectRatio),
          smallestPixelValue: toNumber(instance.SmallestPixelValue),
          largestPixelValue: toNumber(instance.LargestPixelValue),
          redPaletteColorLookupTableDescriptor: toNumber(
            instance.RedPaletteColorLookupTableDescriptor
          ),
          greenPaletteColorLookupTableDescriptor: toNumber(
            instance.GreenPaletteColorLookupTableDescriptor
          ),
          bluePaletteColorLookupTableDescriptor: toNumber(
            instance.BluePaletteColorLookupTableDescriptor
          ),
          redPaletteColorLookupTableData: fetchPaletteColorLookupTableData(
            instance,
            'RedPaletteColorLookupTableData',
            'RedPaletteColorLookupTableDescriptor'
          ),
          greenPaletteColorLookupTableData: fetchPaletteColorLookupTableData(
            instance,
            'GreenPaletteColorLookupTableData',
            'GreenPaletteColorLookupTableDescriptor'
          ),
          bluePaletteColorLookupTableData: fetchPaletteColorLookupTableData(
            instance,
            'BluePaletteColorLookupTableData',
            'BluePaletteColorLookupTableDescriptor'
          ),
        };

        break;
      case WADO_IMAGE_LOADER_TAGS.VOI_LUT_MODULE:
        const { WindowCenter, WindowWidth, VOILUTFunction } = instance;
        if (WindowCenter == null || WindowWidth == null) {
          return;
        }
        const windowCenter = Array.isArray(WindowCenter) ? WindowCenter : [WindowCenter];
        const windowWidth = Array.isArray(WindowWidth) ? WindowWidth : [WindowWidth];

        metadata = {
          windowCenter: toNumber(windowCenter),
          windowWidth: toNumber(windowWidth),
          voiLUTFunction: VOILUTFunction,
        };

        break;
      case WADO_IMAGE_LOADER_TAGS.MODALITY_LUT_MODULE:
        const { RescaleIntercept, RescaleSlope } = instance;
        // Early return if RescaleIntercept or RescaleSlope are not
        // present (undefined) or explicitly set to null. We use loose
        // equality in this case to check for *null* or *undefined*.
        if (RescaleIntercept == null || RescaleSlope == null) {
          return;
        }

        metadata = {
          rescaleIntercept: toNumber(instance.RescaleIntercept),
          rescaleSlope: toNumber(instance.RescaleSlope),
          rescaleType: instance.RescaleType,
        };
        break;
      case WADO_IMAGE_LOADER_TAGS.SOP_COMMON_MODULE:
        metadata = {
          sopClassUID: instance.SOPClassUID,
          sopInstanceUID: instance.SOPInstanceUID,
        };
        break;
      case WADO_IMAGE_LOADER_TAGS.PET_IMAGE_MODULE:
        metadata = {
          frameReferenceTime: instance.FrameReferenceTime,
          actualFrameDuration: instance.ActualFrameDuration,
        };
        break;
      case WADO_IMAGE_LOADER_TAGS.PET_ISOTOPE_MODULE:
        const { RadiopharmaceuticalInformationSequence } = instance;

        if (RadiopharmaceuticalInformationSequence) {
          const RadiopharmaceuticalInformation = Array.isArray(
            RadiopharmaceuticalInformationSequence
          )
            ? RadiopharmaceuticalInformationSequence[0]
            : RadiopharmaceuticalInformationSequence;

          const { RadiopharmaceuticalStartTime, RadionuclideTotalDose, RadionuclideHalfLife } =
            RadiopharmaceuticalInformation;

          const radiopharmaceuticalInfo = {
            radiopharmaceuticalStartTime: dicomParser.parseTM(RadiopharmaceuticalStartTime),
            radionuclideTotalDose: RadionuclideTotalDose,
            radionuclideHalfLife: RadionuclideHalfLife,
          };
          metadata = {
            radiopharmaceuticalInfo,
          };
        }

        break;
      case WADO_IMAGE_LOADER_TAGS.OVERLAY_PLANE_MODULE:
        const overlays = [];

        for (let overlayGroup = 0x00; overlayGroup <= 0x1e; overlayGroup += 0x02) {
          let groupStr = `60${overlayGroup.toString(16)}`;

          if (groupStr.length === 3) {
            groupStr = `600${overlayGroup.toString(16)}`;
          }

          const OverlayDataTag = `${groupStr}3000`;
          const OverlayData = instance[OverlayDataTag];

          if (!OverlayData) {
            continue;
          }

          const OverlayRowsTag = `${groupStr}0010`;
          const OverlayColumnsTag = `${groupStr}0011`;
          const OverlayType = `${groupStr}0040`;
          const OverlayOriginTag = `${groupStr}0050`;
          const OverlayDescriptionTag = `${groupStr}0022`;
          const OverlayLabelTag = `${groupStr}1500`;
          const ROIAreaTag = `${groupStr}1301`;
          const ROIMeanTag = `${groupStr}1302`;
          const ROIStandardDeviationTag = `${groupStr}1303`;
          const OverlayOrigin = instance[OverlayOriginTag];

          let rows = 0;
          if (instance[OverlayRowsTag] instanceof Array) {
            // The DICOM VR for overlay rows is US (unsigned short).
            const rowsInt16Array = new Uint16Array(instance[OverlayRowsTag][0]);
            rows = rowsInt16Array[0];
          } else {
            rows = instance[OverlayRowsTag];
          }

          let columns = 0;
          if (instance[OverlayColumnsTag] instanceof Array) {
            // The DICOM VR for overlay columns is US (unsigned short).
            const columnsInt16Array = new Uint16Array(instance[OverlayColumnsTag][0]);
            columns = columnsInt16Array[0];
          } else {
            columns = instance[OverlayColumnsTag];
          }

          let x = 0;
          let y = 0;
          if (OverlayOrigin.length === 1) {
            // The DICOM VR for overlay origin is SS (signed short) with a multiplicity of 2.
            const originInt16Array = new Int16Array(OverlayOrigin[0]);
            x = originInt16Array[0];
            y = originInt16Array[1];
          } else {
            x = OverlayOrigin[0];
            y = OverlayOrigin[1];
          }

          const overlay = {
            rows: rows,
            columns: columns,
            type: instance[OverlayType],
            x,
            y,
            pixelData: OverlayData,
            description: instance[OverlayDescriptionTag],
            label: instance[OverlayLabelTag],
            roiArea: instance[ROIAreaTag],
            roiMean: instance[ROIMeanTag],
            roiStandardDeviation: instance[ROIStandardDeviationTag],
          };

          overlays.push(overlay);
        }

        metadata = {
          overlays,
        };

        break;

      case WADO_IMAGE_LOADER_TAGS.PATIENT_MODULE:
        const { PatientName } = instance;

        let patientName;
        if (PatientName) {
          patientName = formatPN(PatientName);
        }

        metadata = {
          patientName,
          patientId: instance.PatientID,
        };

        break;

      case WADO_IMAGE_LOADER_TAGS.GENERAL_IMAGE_MODULE:
        metadata = {
          sopInstanceUID: instance.SOPInstanceUID,
          instanceNumber: toNumber(instance.InstanceNumber),
          lossyImageCompression: instance.LossyImageCompression,
          lossyImageCompressionRatio: instance.LossyImageCompressionRatio,
          lossyImageCompressionMethod: instance.LossyImageCompressionMethod,
        };

        break;
      case WADO_IMAGE_LOADER_TAGS.GENERAL_STUDY_MODULE:
        metadata = {
          studyDescription: instance.StudyDescription,
          studyDate: instance.StudyDate,
          studyTime: instance.StudyTime,
          accessionNumber: instance.AccessionNumber,
        };

        break;
      case WADO_IMAGE_LOADER_TAGS.CINE_MODULE:
        metadata = {
          frameTime: instance.FrameTime,
          numberOfFrames: instance.NumberOfFrames ? Number(instance.NumberOfFrames) : 1,
        };

        break;
      case WADO_IMAGE_LOADER_TAGS.PET_SERIES_MODULE:
        metadata = {
          correctedImage: instance.CorrectedImage,
          units: instance.Units,
          decayCorrection: instance.DecayCorrection,
        };
        break;
      case WADO_IMAGE_LOADER_TAGS.CALIBRATION_MODULE:
        // map the DICOM tags to the cornerstone tags since cornerstone tags
        // are camelCase and instance tags are all caps
        metadata = {
          sequenceOfUltrasoundRegions: instance.SequenceOfUltrasoundRegions?.map(region => {
            return {
              regionSpatialFormat: region.RegionSpatialFormat,
              regionDataType: region.RegionDataType,
              regionFlags: region.RegionFlags,
              regionLocationMinX0: region.RegionLocationMinX0,
              regionLocationMinY0: region.RegionLocationMinY0,
              regionLocationMaxX1: region.RegionLocationMaxX1,
              regionLocationMaxY1: region.RegionLocationMaxY1,
              referencePixelX0: region.ReferencePixelX0,
              referencePixelY0: region.ReferencePixelY0,
              referencePixelPhysicalValueX: region.ReferencePixelPhysicalValueX,
              referencePixelPhysicalValueY: region.ReferencePixelPhysicalValueY,
              physicalUnitsXDirection: region.PhysicalUnitsXDirection,
              physicalUnitsYDirection: region.PhysicalUnitsYDirection,
              physicalDeltaX: region.PhysicalDeltaX,
              physicalDeltaY: region.PhysicalDeltaY,
            };
          }),
        };
        break;

      /**
       * Below are the tags and not the modules since they are not really
       * consistent with the modules above
       */
      case 'temporalPositionIdentifier':
        metadata = {
          temporalPositionIdentifier: instance.TemporalPositionIdentifier,
        };
        break;

      default:
        return;
    }

    return metadata;
  }

  /**
   * Retrieves the frameNumber information, depending on the url style
   * wadors /frames/1
   * wadouri &frame=1
   * @param {*} imageId
   * @returns
   */
  getFrameInformationFromURL(imageId) {
    function getInformationFromURL(informationString, separator) {
      let result = '';
      const splittedStr = imageId.split(informationString)[1];
      if (splittedStr.includes(separator)) {
        result = splittedStr.split(separator)[0];
      } else {
        result = splittedStr;
      }
      return result;
    }

    if (imageId.includes('/frames')) {
      return getInformationFromURL('/frames', '/');
    }
    if (imageId.includes('&frame=')) {
      return getInformationFromURL('&frame=', '&');
    }
    return;
  }

  getUIDsFromImageID(imageId) {
    if (imageId.startsWith('wadors:')) {
      const strippedImageId = imageId.split('/studies/')[1];
      const splitImageId = strippedImageId.split('/');

      return {
        StudyInstanceUID: splitImageId[0], // Note: splitImageId[1] === 'series'
        SeriesInstanceUID: splitImageId[2], // Note: splitImageId[3] === 'instances'
        SOPInstanceUID: splitImageId[4],
        frameNumber: splitImageId[6],
      };
    } else if (imageId.includes('?requestType=WADO')) {
      const qs = queryString.parse(imageId);

      return {
        StudyInstanceUID: qs.studyUID,
        SeriesInstanceUID: qs.seriesUID,
        SOPInstanceUID: qs.objectUID,
        frameNumber: qs.frameNumber,
      };
    }

    // Maybe its a non-standard imageId
    // check if the imageId starts with http:// or https:// using regex
    // Todo: handle non http imageIds
    let imageURI;
    const urlRegex = /^(http|https|dicomfile):\/\//;
    if (urlRegex.test(imageId)) {
      imageURI = imageId;
    } else {
      imageURI = imageIdToURI(imageId);
    }

    // remove &frame=number from imageId
    imageURI = imageURI.split('&frame=')[0];

    const uids = this.imageURIToUIDs.get(imageURI);
    const frameNumber = this.getFrameInformationFromURL(imageId) || '1';

    if (uids && frameNumber !== undefined) {
      return { ...uids, frameNumber };
    }
    return uids;
  }
}

const metadataProvider = new MetadataProvider();

export default metadataProvider;

const WADO_IMAGE_LOADER = {
  imagePlaneModule: instance => {
    const { ImageOrientationPatient, ImagePositionPatient } = instance;

    // Fallback for DX images.
    // TODO: We should use the rest of the results of this function
    // to update the UI somehow
    const { PixelSpacing, type } = getPixelSpacingInformation(instance) || {};

    let rowPixelSpacing;
    let columnPixelSpacing;

    let rowCosines;
    let columnCosines;

    let usingDefaultValues = false;
    let isDefaultValueSetForRowCosine = false;
    let isDefaultValueSetForColumnCosine = false;
    let imageOrientationPatient;
    if (PixelSpacing) {
      [rowPixelSpacing, columnPixelSpacing] = PixelSpacing;
      const calibratedPixelSpacing = utilities.calibratedPixelSpacingMetadataProvider.get(
        'calibratedPixelSpacing',
        instance.imageId
      );
      if (!calibratedPixelSpacing) {
        calibratedPixelSpacingMetadataProvider.add(instance.imageId, {
          rowPixelSpacing: parseFloat(PixelSpacing[0]),
          columnPixelSpacing: parseFloat(PixelSpacing[1]),
          type,
        });
      }
    } else {
      rowPixelSpacing = columnPixelSpacing = 1;
      usingDefaultValues = true;
    }

    if (ImageOrientationPatient) {
      rowCosines = toNumber(ImageOrientationPatient.slice(0, 3));
      columnCosines = toNumber(ImageOrientationPatient.slice(3, 6));
      imageOrientationPatient = toNumber(ImageOrientationPatient);
    } else {
      rowCosines = [1, 0, 0];
      columnCosines = [0, 1, 0];
      imageOrientationPatient = [1, 0, 0, 0, 1, 0];
      usingDefaultValues = true;
      isDefaultValueSetForRowCosine = true;
      isDefaultValueSetForColumnCosine = true;
    }

    const imagePositionPatient = toNumber(ImagePositionPatient) || [0, 0, 0];
    if (!ImagePositionPatient) {
      usingDefaultValues = true;
    }

    return {
      frameOfReferenceUID: instance.FrameOfReferenceUID,
      rows: toNumber(instance.Rows),
      columns: toNumber(instance.Columns),
      spacingBetweenSlices: toNumber(instance.SpacingBetweenSlices),
      imageOrientationPatient,
      rowCosines,
      isDefaultValueSetForRowCosine,
      columnCosines,
      isDefaultValueSetForColumnCosine,
      imagePositionPatient,
      sliceThickness: toNumber(instance.SliceThickness),
      sliceLocation: toNumber(instance.SliceLocation),
      pixelSpacing: toNumber(PixelSpacing || 1),
      rowPixelSpacing: rowPixelSpacing ? toNumber(rowPixelSpacing) : null,
      columnPixelSpacing: columnPixelSpacing ? toNumber(columnPixelSpacing) : null,
      usingDefaultValues,
    };
  },
};

const WADO_IMAGE_LOADER_TAGS = {
  // dicomImageLoader specific
  GENERAL_SERIES_MODULE: 'generalSeriesModule',
  PATIENT_STUDY_MODULE: 'patientStudyModule',
  IMAGE_PIXEL_MODULE: 'imagePixelModule',
  VOI_LUT_MODULE: 'voiLutModule',
  MODALITY_LUT_MODULE: 'modalityLutModule',
  SOP_COMMON_MODULE: 'sopCommonModule',
  PET_IMAGE_MODULE: 'petImageModule',
  PET_ISOTOPE_MODULE: 'petIsotopeModule',
  PET_SERIES_MODULE: 'petSeriesModule',
  OVERLAY_PLANE_MODULE: 'overlayPlaneModule',
  PATIENT_DEMOGRAPHIC_MODULE: 'patientDemographicModule',

  // react-cornerstone-viewport specific
  PATIENT_MODULE: 'patientModule',
  GENERAL_IMAGE_MODULE: 'generalImageModule',
  GENERAL_STUDY_MODULE: 'generalStudyModule',
  CINE_MODULE: 'cineModule',
  CALIBRATION_MODULE: 'calibrationModule',
};

const INSTANCE = 'instance';
