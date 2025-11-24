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

/**
 * Generates a DICOM SEG dataset from a segmentation
 * Uses a more robust approach that works with XNAT segmentation structure
 */
export function generateSegmentation(
  { segmentationId, options = {} }: { segmentationId: string; options?: any },
  { segmentationService }: SegmentationGeneratorParams
) {
  // Get segmentation from both sources to ensure compatibility
  const segmentationInOHIF = segmentationService.getSegmentation(segmentationId);
  const cornerstoneSegmentation = cornerstoneToolsSegmentation.state.getSegmentation(segmentationId);

  if (!segmentationInOHIF || !cornerstoneSegmentation) {
    throw new Error('Segmentation not found');
  }

  // Get the labelmap representation data
  const { representationData } = cornerstoneSegmentation;
  const labelmapData = representationData.Labelmap;

  if (!labelmapData) {
    throw new Error('No labelmap data found in segmentation');
  }

  // Get image IDs - handle both volumeId and imageIds cases
  let imageIds: string[] = [];
  if ('imageIds' in labelmapData && labelmapData.imageIds) {
    imageIds = labelmapData.imageIds;
  } else if ('volumeId' in labelmapData && labelmapData.volumeId) {
    // Get imageIds from volume cache
    const volume = cache.getVolume(labelmapData.volumeId);
    if (volume && volume.imageIds) {
      imageIds = volume.imageIds;
    }
  }

  if (!imageIds || imageIds.length === 0) {
    throw new Error('No image IDs found for segmentation');
  }

  const segImages = imageIds.map(imageId => cache.getImage(imageId));
  const referencedImages = segImages.map(image => cache.getImage(image.referencedImageId));

  // Reverse the order of images for DICOM SEG export
  // ITK-Snap shows frames flipped, so reverse the current order
  const reversedReferencedImages = [...referencedImages].reverse();
  const reversedSegImages = [...segImages].reverse();

  const labelmaps2D = [];
  let z = 0;

  for (const segImage of reversedSegImages) {
    const segmentsOnLabelmap = new Set();
    const pixelData = segImage.getPixelData();
    const { rows, columns } = segImage;

    // Use a single pass through the pixel data
    for (let i = 0; i < pixelData.length; i++) {
      const segment = pixelData[i];
      if (segment !== 0) {
        segmentsOnLabelmap.add(segment);
      }
    }

    labelmaps2D[z++] = {
      segmentsOnLabelmap: Array.from(segmentsOnLabelmap),
      pixelData,
      rows,
      columns,
    };
  }

  const allSegmentsOnLabelmap = labelmaps2D.map(labelmap => labelmap.segmentsOnLabelmap);

  const labelmap3D = {
    segmentsOnLabelmap: Array.from(new Set(allSegmentsOnLabelmap.flat())),
    metadata: [],
    labelmaps2D,
  };

  // Get representations for color information
  const representations = segmentationService.getRepresentationsForSegmentation(segmentationId);

  // Build segment metadata
  Object.entries(segmentationInOHIF.segments || {}).forEach(([segmentIndex, segment]) => {
    if (!segment) {
      return;
    }
    const segmentLabel = (segment as any).label || `Segment ${segmentIndex}`;

    // Use the first representation to get color information
    const representation = representations && representations.length > 0 ? representations[0] : null;
    const rgbaColor = getSegmentColor(representation, Number(segmentIndex));
    const RecommendedDisplayCIELabValue = rgbaToDICOMLab(rgbaColor);

    labelmap3D.metadata[parseInt(segmentIndex)] = {
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

  // Generate the segmentation using cornerstone adapters
  const {
    Cornerstone3D: {
      Segmentation: { generateSegmentation: csGenerateSegmentation },
    },
  } = adaptersSEG;

  const dataset = csGenerateSegmentation(
    reversedReferencedImages,
    labelmap3D,
    metaData,
    {
      ...options,
      SeriesDescription: options.SeriesDescription || 'Segmentation',
      SeriesNumber: options.SeriesNumber || '300',
      InstanceNumber: options.InstanceNumber || '1',
      Manufacturer: options.Manufacturer || 'Cornerstone.js',
      ManufacturerModelName: options.ManufacturerModelName || 'Cornerstone3D',
      SoftwareVersions: options.SoftwareVersions || '1.0.0',
      TransferSyntaxUID: options.TransferSyntaxUID || '1.2.840.10008.1.2', // Implicit VR Little Endian
      ImplementationClassUID: options.ImplementationClassUID || '1.2.40.0.13.1.1',
      ImplementationVersionName: options.ImplementationVersionName || 'OHIF_XNAT',
    }
  );

  // The Cornerstone adapters return a Segmentation object with a .dataset property
  // Extract the actual DICOM dataset for compatibility with dcmjs
  return dataset.dataset;
}
