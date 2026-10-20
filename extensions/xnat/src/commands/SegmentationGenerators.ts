/**
 * Segmentation generation and creation utilities
 * Extracted from segmentationCommands.ts
 */

import { metaData } from '@cornerstonejs/core';
import { adaptersSEG } from '@cornerstonejs/adapters';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import dcmjs from 'dcmjs';
import { getAppCornerstone } from '../registerVoiLutModuleHandler';

export interface SegmentationGeneratorParams {
  segmentationService: any;
  extensionManager?: any;
}

type ImageCache = {
  getImage: (imageId: string) => any;
  getVolume?: (volumeId: string) => any;
};

/**
 * The segmentation panel id is stored in the viewer's Cornerstone Tools state.
 * This extension depends on an older Tools package, so its own
 * `segmentation.state` is a different singleton and will not see that segmentation.
 */
export function resolveSegmentationForExport(
  segmentationService: {
    getSegmentation?: (segmentationId: string) => any;
    getActiveSegmentation?: (viewportId: string) => any;
  },
  segmentationId?: string,
  viewportId?: string
) {
  if (segmentationId) {
    const found = segmentationService.getSegmentation?.(segmentationId);
    if (found) {
      return found;
    }
  }

  if (viewportId) {
    return segmentationService.getActiveSegmentation?.(viewportId);
  }

  return undefined;
}

const DEFAULT_RGBA = [255, 0, 0, 255];

type Labelmap2D = {
  segmentsOnLabelmap: number[];
  pixelData: ArrayLike<number>;
  rows: number;
  columns: number;
};

function hasDicomByteArray(image: any): boolean {
  return Boolean(image?.data?.byteArray?.buffer);
}

/**
 * Legacy Cornerstone SEG export reads Part-10 bytes from `image.data.byteArray`.
 * Streaming / naturalized-metadata loads often leave `image.data` as metadata only
 * (no byteArray). Hydrate from the dicom-image-loader dataset cache or re-fetch.
 */
async function ensureDicomByteArray(image: any): Promise<any> {
  if (hasDicomByteArray(image)) {
    return image;
  }

  const imageId = image?.imageId;
  if (!imageId) {
    throw new Error('Reference image is missing imageId required for SEG export');
  }

  const { parseImageId, dataSetCacheManager, getLoaderForScheme } =
    dicomImageLoader.wadouri;
  const parsed = parseImageId(imageId);
  const loader = getLoaderForScheme(parsed.scheme);

  let dataSet = dataSetCacheManager.get(parsed.url);
  if (!dataSet) {
    if (loader) {
      dataSet = await dataSetCacheManager.load(parsed.url, loader, imageId);
    } else {
      const response = await fetch(parsed.url, {
        credentials: 'include',
        headers: { Accept: 'application/dicom,*/*' },
      });
      if (!response.ok) {
        throw new Error(
          `Failed to fetch DICOM bytes for ${imageId}: HTTP ${response.status}`
        );
      }
      const arrayBuffer = await response.arrayBuffer();
      return {
        ...image,
        data: { byteArray: new Uint8Array(arrayBuffer) },
      };
    }
  }

  if (!dataSet?.byteArray?.buffer) {
    throw new Error(
      `Reference image ${imageId} is missing DICOM byte data required for SEG export`
    );
  }

  // Shallow copy so we do not replace naturalized metadata on the cached image.
  return {
    ...image,
    data: dataSet,
  };
}

function getSegmentColor(
  representation: any,
  segmentIndex: number
): number[] {
  if (!representation?.colorLUT) {
    return DEFAULT_RGBA;
  }

  const { colorLUT } = representation;

  if (Array.isArray(colorLUT)) {
    return colorLUT[segmentIndex] || DEFAULT_RGBA;
  }

  if (colorLUT instanceof Map) {
    return colorLUT.get(segmentIndex) || DEFAULT_RGBA;
  }

  if (
    typeof colorLUT === 'object' &&
    colorLUT !== null &&
    segmentIndex in colorLUT
  ) {
    return colorLUT[segmentIndex] || DEFAULT_RGBA;
  }

  return DEFAULT_RGBA;
}

function rgbaToDICOMLab(rgba: number[]): number[] {
  const rgbSource =
    Array.isArray(rgba) && rgba.length >= 3 ? rgba : DEFAULT_RGBA;
  const rgb = rgbSource.slice(0, 3).map(value =>
    Math.min(255, Math.max(0, value))
  );
  const normalized = rgb.map(value => value / 255);

  const cielab = dcmjs.data.Colors.rgb2DICOMLAB(normalized);

  return cielab.map((value: number) => Math.round(value));
}

export function normalizeImageOrientationPatient(raw: unknown): number[] | undefined {
  if (!raw) {
    return undefined;
  }

  let arr: unknown = raw;
  if (typeof raw === 'string') {
    arr = raw.split('\\').map(v => Number(v.trim()));
  } else if (Array.isArray(raw)) {
    arr = raw.map(v => Number(v));
  } else {
    return undefined;
  }

  if (!Array.isArray(arr) || arr.length !== 6) {
    return undefined;
  }

  return arr.map(v => {
    const n = Number(v);
    if (Math.abs(n) < 1e-12) {
      return 0;
    }
    return Math.round(n * 1e5) / 1e5;
  });
}

/**
 * Fill shared/per-frame functional groups that external viewers (Horos, ITK-Snap) and
 * XNAT ROI import expect.
 */
export function enrichSegDataset(
  dataset: Record<string, any>,
  sourceMeta: {
    PixelSpacing?: unknown;
    SliceThickness?: unknown;
    SpacingBetweenSlices?: unknown;
    ImageOrientationPatient?: unknown;
  }
): void {
  if (!dataset) {
    return;
  }

  const pixelSpacing = sourceMeta.PixelSpacing;
  const sliceThickness =
    sourceMeta.SliceThickness ?? sourceMeta.SpacingBetweenSlices;
  const normalizedOrientation = normalizeImageOrientationPatient(
    sourceMeta.ImageOrientationPatient
  );

  if (!dataset.SharedFunctionalGroupsSequence?.length) {
    dataset.SharedFunctionalGroupsSequence = [{}];
  }
  const sharedFG = dataset.SharedFunctionalGroupsSequence[0];

  if (pixelSpacing && sliceThickness != null) {
    if (!sharedFG.PixelMeasuresSequence?.length) {
      sharedFG.PixelMeasuresSequence = [
        {
          PixelSpacing: pixelSpacing,
          SliceThickness: sliceThickness,
          SpacingBetweenSlices: sourceMeta.SpacingBetweenSlices ?? sliceThickness,
        },
      ];
    }
  }

  if (normalizedOrientation) {
    sharedFG.PlaneOrientationSequence = [
      { ImageOrientationPatient: normalizedOrientation },
    ];

    if (Array.isArray(dataset.PerFrameFunctionalGroupsSequence)) {
      dataset.PerFrameFunctionalGroupsSequence.forEach((frameFG: Record<string, any>) => {
        if (!frameFG) {
          return;
        }
        if (!frameFG.PlaneOrientationSequence?.length) {
          frameFG.PlaneOrientationSequence = [
            { ImageOrientationPatient: normalizedOrientation },
          ];
          return;
        }
        frameFG.PlaneOrientationSequence[0].ImageOrientationPatient =
          normalizedOrientation;
      });
    }
  }
}

function enrichSegDatasetFromImageId(
  dataset: Record<string, any>,
  imageId: string,
  metaDataProvider: { get: (type: string, imageId: string) => unknown } = metaData
) {
  const instance = metaDataProvider.get('instance', imageId) as Record<string, unknown> | undefined;
  const plane = metaDataProvider.get('imagePlaneModule', imageId) as
    | Record<string, unknown>
    | undefined;
  enrichSegDataset(dataset, {
    PixelSpacing: plane?.pixelSpacing ?? instance?.PixelSpacing,
    SliceThickness: plane?.sliceThickness ?? instance?.SliceThickness,
    SpacingBetweenSlices:
      plane?.spacingBetweenSlices ?? instance?.SpacingBetweenSlices,
    ImageOrientationPatient:
      plane?.imageOrientationPatient ?? instance?.ImageOrientationPatient,
  });
}

/**
 * Cornerstone3D's generateSegmentation builds one dataset per slice and runs dcmjs
 * convertToMultiframe on MR buffers — that produces invalid SEGs (Horos/ITK-Snap
 * cannot open them). The legacy Cornerstone adapter reads the real DICOM buffer
 * from the first multiframe source image instead.
 */
async function prepareReferenceImagesForSegExport(
  referencedImages: any[],
  metaDataProvider: { get: (type: string, imageId: string) => unknown } = metaData
): Promise<any[]> {
  const valid = referencedImages.filter(image => image?.imageId);
  if (!valid.length) {
    throw new Error('No reference images available for SEG export');
  }

  const firstCached = valid[0];
  const instance = metaDataProvider.get('instance', firstCached.imageId) as
    | Record<string, unknown>
    | undefined;
  const numberOfFrames = Number(
    firstCached.NumberOfFrames ?? instance?.NumberOfFrames ?? 0
  );

  if (numberOfFrames > 1) {
    const first = await ensureDicomByteArray(firstCached);
    if (!first.NumberOfFrames) {
      first.NumberOfFrames = numberOfFrames;
    }
    if (!hasDicomByteArray(first)) {
      throw new Error(
        'Multiframe reference image is missing DICOM byte data required for SEG export'
      );
    }
    return [first];
  }

  const hydrated = await Promise.all(valid.map(ensureDicomByteArray));

  for (const image of hydrated) {
    if (!hasDicomByteArray(image)) {
      throw new Error(
        `Reference image ${image.imageId} is missing DICOM byte data required for SEG export`
      );
    }
  }

  return hydrated;
}

/**
 * Generates a DICOM SEG dataset from a segmentation
 */
function labelmapPixelData(image: any): ArrayLike<number> | undefined {
  if (typeof image?.getPixelData === 'function') {
    return image.getPixelData();
  }
  if (typeof image?.voxelManager?.getScalarData === 'function') {
    return image.voxelManager.getScalarData();
  }
  return undefined;
}

function viewerImageAccess(extensionManager?: any): {
  imageCache: ImageCache;
  metaDataProvider: { get: (type: string, imageId: string) => unknown };
} {
  const appCornerstone = getAppCornerstone(extensionManager);
  const imageCache = appCornerstone?.cache;
  if (!imageCache?.getImage) {
    throw new Error('Viewer image cache is unavailable for SEG export');
  }

  return {
    imageCache,
    metaDataProvider: appCornerstone?.metaData ?? metaData,
  };
}

export async function generateSegmentation(
  { segmentationId, options = {} }: { segmentationId: string; options?: any },
  { segmentationService, extensionManager }: SegmentationGeneratorParams
) {
  const segmentationInOHIF = segmentationService.getSegmentation(segmentationId);

  if (!segmentationInOHIF) {
    throw new Error('Segmentation not found');
  }

  const { imageCache, metaDataProvider } = viewerImageAccess(extensionManager);
  const { representationData } = segmentationInOHIF;
  const labelmapData = representationData?.Labelmap ?? representationData?.LABELMAP;

  if (!labelmapData) {
    throw new Error('No labelmap data found in segmentation');
  }

  let imageIds: string[] = [];
  if (Array.isArray(labelmapData.imageIds) && labelmapData.imageIds.length) {
    imageIds = labelmapData.imageIds;
  } else if (labelmapData.volumeId && imageCache.getVolume) {
    const volume = imageCache.getVolume(labelmapData.volumeId);
    if (volume?.imageIds) {
      imageIds = volume.imageIds;
    }
  }

  if (!imageIds.length) {
    throw new Error('No image IDs found for segmentation');
  }

  const referencedImageIds: string[] = Array.isArray(labelmapData.referencedImageIds)
    ? labelmapData.referencedImageIds
    : [];
  const segImages = imageIds.map(imageId => imageCache.getImage(imageId));
  const referencedImages = segImages.map((image, index) => {
    const referencedImageId = image?.referencedImageId ?? referencedImageIds[index];
    return referencedImageId ? imageCache.getImage(referencedImageId) : undefined;
  });

  const labelmaps2D: Labelmap2D[] = [];

  for (const segImage of segImages) {
    const pixelData = labelmapPixelData(segImage);
    if (!pixelData || segImage?.rows == null || segImage?.columns == null) {
      throw new Error('Missing labelmap image data for SEG export');
    }

    const segmentsOnLabelmap = new Set<number>();
    const { rows, columns } = segImage;

    for (let i = 0; i < pixelData.length; i++) {
      const segment = pixelData[i];
      if (segment !== 0) {
        segmentsOnLabelmap.add(segment);
      }
    }

    labelmaps2D.push({
      segmentsOnLabelmap: Array.from(segmentsOnLabelmap),
      pixelData,
      rows,
      columns,
    });
  }

  const labelmap3D = {
    segmentsOnLabelmap: Array.from(
      new Set(labelmaps2D.flatMap(labelmap => labelmap.segmentsOnLabelmap))
    ),
    metadata: [] as any[],
    labelmaps2D,
  };

  const representations = segmentationService.getRepresentationsForSegmentation(segmentationId);

  Object.entries(segmentationInOHIF.segments || {}).forEach(([segmentIndex, segment]) => {
    if (!segment) {
      return;
    }
    const segmentLabel = (segment as any).label || `Segment ${segmentIndex}`;
    const representation = representations?.length ? representations[0] : null;
    const rgbaColor = getSegmentColor(representation, Number(segmentIndex));
    const RecommendedDisplayCIELabValue = rgbaToDICOMLab(rgbaColor);

    labelmap3D.metadata[parseInt(segmentIndex, 10)] = {
      SegmentNumber: segmentIndex,
      SegmentLabel: segmentLabel,
      SegmentAlgorithmType: 'MANUAL',
      SegmentAlgorithmName: 'Manual',
      RecommendedDisplayCIELabValue,
      SegmentedPropertyCategoryCodeSequence: {
        CodeValue: 'T-D000A',
        CodingSchemeDesignator: 'SRT',
        CodeMeaning: 'Anatomical Structure',
      },
      SegmentedPropertyTypeCodeSequence: {
        CodeValue: 'T-D000A',
        CodingSchemeDesignator: 'SRT',
        CodeMeaning: 'Anatomical Structure',
      },
    };
  });

  const {
    Cornerstone: {
      Segmentation: { generateSegmentation: cornerstoneGenerateSegmentation },
    },
  } = adaptersSEG;

  const exportReferenceImages = await prepareReferenceImagesForSegExport(
    referencedImages,
    metaDataProvider
  );

  const segResult = cornerstoneGenerateSegmentation(
    exportReferenceImages,
    labelmap3D,
    {
      ...options,
      SeriesDescription: options.SeriesDescription || 'Segmentation',
      SeriesNumber: options.SeriesNumber || '300',
      InstanceNumber: options.InstanceNumber || '1',
      Manufacturer: options.Manufacturer || 'Cornerstone.js',
      ManufacturerModelName: options.ManufacturerModelName || 'Cornerstone3D',
      SoftwareVersions: options.SoftwareVersions || '1.0.0',
      rleEncode: false,
      includeSliceSpacing: true,
    }
  );

  const dataset = segResult?.dataset;
  if (!dataset) {
    throw new Error('Failed to generate DICOM SEG dataset');
  }

  enrichSegDatasetFromImageId(
    dataset,
    exportReferenceImages[0].imageId,
    metaDataProvider
  );

  return dataset;
}
