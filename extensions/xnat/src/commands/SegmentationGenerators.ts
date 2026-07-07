/**
 * Segmentation generation and creation utilities
 * Extracted from segmentationCommands.ts
 */

import { cache, metaData } from '@cornerstonejs/core';
import { segmentation as cornerstoneToolsSegmentation } from '@cornerstonejs/tools';
import { adaptersSEG } from '@cornerstonejs/adapters';
import dcmjs from 'dcmjs';

export interface SegmentationGeneratorParams {
  segmentationService: any;
}

const DEFAULT_RGBA = [255, 0, 0, 255];

type Labelmap2D = {
  segmentsOnLabelmap: number[];
  pixelData: ArrayLike<number>;
  rows: number;
  columns: number;
};

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

function enrichSegDatasetFromImageId(dataset: Record<string, any>, imageId: string) {
  const instance = metaData.get('instance', imageId) as Record<string, unknown> | undefined;
  const plane = metaData.get('imagePlaneModule', imageId) as Record<string, unknown> | undefined;
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
function prepareReferenceImagesForSegExport(referencedImages: any[]): any[] {
  const valid = referencedImages.filter(image => image?.imageId);
  if (!valid.length) {
    throw new Error('No reference images available for SEG export');
  }

  const first = valid[0];
  const instance = metaData.get('instance', first.imageId) as Record<string, unknown> | undefined;
  const numberOfFrames = Number(first.NumberOfFrames ?? instance?.NumberOfFrames ?? 0);

  if (numberOfFrames > 1) {
    if (!first.NumberOfFrames) {
      first.NumberOfFrames = numberOfFrames;
    }
    if (!first.data?.byteArray?.buffer) {
      throw new Error(
        'Multiframe reference image is missing DICOM byte data required for SEG export'
      );
    }
    return [first];
  }

  for (const image of valid) {
    if (!image.data?.byteArray?.buffer) {
      throw new Error(
        `Reference image ${image.imageId} is missing DICOM byte data required for SEG export`
      );
    }
  }

  return valid;
}

/**
 * Generates a DICOM SEG dataset from a segmentation
 */
export function generateSegmentation(
  { segmentationId, options = {} }: { segmentationId: string; options?: any },
  { segmentationService }: SegmentationGeneratorParams
) {
  const segmentationInOHIF = segmentationService.getSegmentation(segmentationId);
  const cornerstoneSegmentation = cornerstoneToolsSegmentation.state.getSegmentation(segmentationId);

  if (!segmentationInOHIF || !cornerstoneSegmentation) {
    throw new Error('Segmentation not found');
  }

  const { representationData } = cornerstoneSegmentation;
  const labelmapData = representationData.Labelmap;

  if (!labelmapData) {
    throw new Error('No labelmap data found in segmentation');
  }

  let imageIds: string[] = [];
  if ('imageIds' in labelmapData && labelmapData.imageIds) {
    imageIds = labelmapData.imageIds;
  } else if ('volumeId' in labelmapData && labelmapData.volumeId) {
    const volume = cache.getVolume(labelmapData.volumeId);
    if (volume?.imageIds) {
      imageIds = volume.imageIds;
    }
  }

  if (!imageIds.length) {
    throw new Error('No image IDs found for segmentation');
  }

  const segImages = imageIds.map(imageId => cache.getImage(imageId));
  const referencedImages = segImages.map(image => cache.getImage(image.referencedImageId));

  const labelmaps2D: Labelmap2D[] = [];

  for (const segImage of segImages) {
    if (!segImage?.getPixelData) {
      throw new Error('Missing labelmap image data for SEG export');
    }

    const segmentsOnLabelmap = new Set<number>();
    const pixelData = segImage.getPixelData();
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

  const exportReferenceImages = prepareReferenceImagesForSegExport(referencedImages);

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

  enrichSegDatasetFromImageId(dataset, exportReferenceImages[0].imageId);

  return dataset;
}
