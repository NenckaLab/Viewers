/**
 * Cornerstone metadata fallback provider for XNAT imageIds.
 * 1) High-priority provider: resolves imagePlaneModule/frameModule for XNAT frame-level imageIds
 *    (dicomweb:...&frame=N) using the XNAT UIDs map so MPR getClosestImageId works.
 * 2) Low-priority fallback: when all other providers return undefined, returns minimal metadata
 *    so functions like makeVolumeMetadata and isValidVolume don't crash on destructuring.
 */
import { metaData } from '@cornerstonejs/core';
import { DicomMetadataStore, classes, utils } from '@ohif/core';
import { getXNATImageIdUids } from './xnatImageIdUidsMap';
import {
  buildImagePlaneModuleFromInstance,
  getCombinedInstanceForFrame,
} from './xnatImagePlaneModule';

const imageIdToURI = utils.imageIdToURI;
const ohifMetadataProvider = classes.MetadataProvider;

/** Build frameModule from instance. */
function buildFrameModule(instance: Record<string, unknown>, frameNumber: number): Record<string, unknown> {
  return {
    frameNumber,
    numberOfFrames: Number(instance.NumberOfFrames) || 1,
    sopClassUID: instance.SOPClassUID,
    sopInstanceUID: instance.SOPInstanceUID,
    seriesInstanceUID: instance.SeriesInstanceUID,
    studyInstanceUID: instance.StudyInstanceUID,
  };
}

function resolveInstanceUids(imageId: string, baseUri: string) {
  const fromMap = getXNATImageIdUids(baseUri);
  if (fromMap) {
    return fromMap;
  }

  const fromOhif = ohifMetadataProvider.getUIDsFromImageID(imageId);
  if (fromOhif?.StudyInstanceUID && fromOhif?.SeriesInstanceUID && fromOhif?.SOPInstanceUID) {
    return {
      StudyInstanceUID: fromOhif.StudyInstanceUID,
      SeriesInstanceUID: fromOhif.SeriesInstanceUID,
      SOPInstanceUID: fromOhif.SOPInstanceUID,
    };
  }

  return undefined;
}

/**
 * High-priority provider for XNAT frame-level imageIds so MPR volume viewports
 * can resolve imagePlaneModule (getClosestImageId). Returns undefined for non-XNAT
 * or when not in map so the default OHIF provider runs.
 */
function xnatFrameMetadataProvider(type: string, imageId: string): Record<string, unknown> | undefined {
  if (typeof imageId !== 'string' || !imageId || (!imageId.includes('dicomweb:') && !imageId.includes('&frame='))) {
    return undefined;
  }
  if (type !== 'imagePlaneModule' && type !== 'frameModule') {
    return undefined;
  }

  const uri = imageIdToURI(imageId);
  const baseUri = uri.split('&frame=')[0];
  let frameNumber = 1;
  const frameMatch = imageId.match(/[?&]frame=(\d+)/);
  if (frameMatch) {
    frameNumber = parseInt(frameMatch[1], 10) || 1;
  }

  const uids = resolveInstanceUids(imageId, baseUri);
  if (!uids) {
    return undefined;
  }

  const instance = DicomMetadataStore.getInstance(
    uids.StudyInstanceUID,
    uids.SeriesInstanceUID,
    uids.SOPInstanceUID
  ) as Record<string, unknown> | undefined;
  if (!instance) {
    return undefined;
  }

  const combined = getCombinedInstanceForFrame(instance, frameNumber);
  if (!combined) {
    return undefined;
  }

  if (type === 'frameModule') {
    return buildFrameModule(combined, frameNumber);
  }
  return buildImagePlaneModuleFromInstance(combined);
}

const EMPTY_GENERAL_SERIES = {
  modality: 'OT',
  seriesInstanceUID: '',
  studyInstanceUID: '',
  seriesNumber: 0,
  seriesDescription: '',
  seriesDate: '',
  seriesTime: '',
};

/** Minimal imagePixelModule to prevent "Cannot destructure property 'pixelRepresentation'" in makeVolumeMetadata */
const EMPTY_IMAGE_PIXEL_MODULE = {
  pixelRepresentation: 0,
  bitsAllocated: 16,
  bitsStored: 16,
  highBit: 15,
  photometricInterpretation: 'MONOCHROME2',
  samplesPerPixel: 1,
};

/** Minimal imagePlaneModule for makeVolumeMetadata & spacing (orientation, spacing, dimensions) */
const EMPTY_IMAGE_PLANE_MODULE = {
  imageOrientationPatient: [1, 0, 0, 0, 1, 0] as [number, number, number, number, number, number],
  pixelSpacing: [1, 1] as [number, number],
  imagePositionPatient: [0, 0, 0] as [number, number, number],
  frameOfReferenceUID: '',
  columns: 512,
  rows: 512,
};

const FALLBACK_MAP: Record<string, Record<string, unknown>> = {
  generalSeriesModule: EMPTY_GENERAL_SERIES,
  imagePixelModule: EMPTY_IMAGE_PIXEL_MODULE,
  imagePlaneModule: EMPTY_IMAGE_PLANE_MODULE,
};

/**
 * Low-priority fallback: return minimal metadata when all other providers return undefined.
 */
function emptyFallbackProvider(type: string, imageId: string): Record<string, unknown> | undefined {
  if (typeof imageId !== 'string' || !imageId) {
    return undefined;
  }
  const fallback = FALLBACK_MAP[type];
  if (!fallback) {
    return undefined;
  }
  return fallback;
}

/**
 * Register the XNAT metadata fallback provider.
 * Call this from XNAT init after cornerstone is ready.
 * - Priority 10001: XNAT frame-level imagePlaneModule/frameModule so MPR works.
 * - Priority -10000: minimal metadata when others return undefined.
 */
export function registerXnatMetadataFallback(): void {
  metaData.addProvider(xnatFrameMetadataProvider, 10001);
  metaData.addProvider(emptyFallbackProvider, -10000);
}
