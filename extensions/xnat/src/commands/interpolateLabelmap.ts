import { Image, ImageType, IntTypes, PixelTypes } from 'itk-wasm';
import { morphologicalContourInterpolation } from '@itk-wasm/morphological-contour-interpolation';

type ScalarArray = Uint8Array | Uint16Array;

type LabelmapVolume = {
  dimensions?: number[];
  spacing?: number[];
  origin?: number[];
  direction?: number[] | number[][];
  imageData?: {
    getDimensions?: () => number[];
    getSpacing?: () => number[];
    getOrigin?: () => number[];
    getDirection?: () => number[] | number[][];
  };
  voxelManager?: {
    getCompleteScalarDataArray?: () => ScalarArray;
    getScalarData?: () => ScalarArray;
    setCompleteScalarDataArray?: (data: ScalarArray) => void;
    setScalarData?: (data: ScalarArray) => void;
    invalidateCache?: () => void;
    getArrayOfModifiedSlices?: () => number[];
  };
};

function flat9(direction?: number[] | number[][]): Float64Array {
  const identity = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  if (!direction) {
    return identity;
  }
  const flat: number[] = [];
  for (const value of direction as Array<number | number[]>) {
    if (typeof value === 'number') {
      flat.push(value);
    } else if (value) {
      flat.push(...value);
    }
  }
  return flat.length === 9 ? Float64Array.from(flat) : identity;
}

function applyInterpolation(
  merged: ScalarArray,
  original: ArrayLike<number>,
  outputData: ArrayLike<number> | undefined,
  label: number
): number {
  if (!outputData || outputData.length !== original.length) {
    return 0;
  }
  let changed = 0;
  for (let i = 0; i < outputData.length; i++) {
    const next = outputData[i];
    if (next === label && original[i] !== label) {
      merged[i] = label;
      changed++;
    }
  }
  return changed;
}

/** Copy the nearer drawn slice into the unlabeled slices between two drawings. */
function fillGapsFromNearestLabeledSlice(
  data: ScalarArray,
  dimensions: number[],
  label: number
): number {
  const frameSize = dimensions[0] * dimensions[1];
  const depth = dimensions[2];
  const labeled: number[] = [];
  for (let k = 0; k < depth; k++) {
    const start = k * frameSize;
    for (let i = 0; i < frameSize; i++) {
      if (data[start + i] === label) {
        labeled.push(k);
        break;
      }
    }
  }

  let changed = 0;
  for (let pair = 0; pair < labeled.length - 1; pair++) {
    const startSlice = labeled[pair];
    const endSlice = labeled[pair + 1];
    for (let k = startSlice + 1; k < endSlice; k++) {
      const sourceSlice = k - startSlice <= endSlice - k ? startSlice : endSlice;
      const source = sourceSlice * frameSize;
      const dest = k * frameSize;
      for (let i = 0; i < frameSize; i++) {
        if (data[source + i] === label && data[dest + i] !== label) {
          data[dest + i] = label;
          changed++;
        }
      }
    }
  }
  return changed;
}

function slicesWithLabel(data: ArrayLike<number>, dimensions: number[], label: number): number {
  const frameSize = dimensions[0] * dimensions[1];
  let count = 0;
  for (let k = 0; k < dimensions[2]; k++) {
    const start = k * frameSize;
    for (let i = 0; i < frameSize; i++) {
      if (data[start + i] === label) {
        count++;
        break;
      }
    }
  }
  return count;
}

function readScalarData(volume: LabelmapVolume): ScalarArray | null {
  const voxelManager = volume.voxelManager;
  try {
    const complete = voxelManager?.getCompleteScalarDataArray?.();
    if (complete?.length) {
      return complete;
    }
  } catch {
    // Image-backed volumes throw on getScalarData; the complete array is the fallback.
  }
  try {
    const scalar = voxelManager?.getScalarData?.();
    return scalar?.length ? scalar : null;
  } catch {
    return null;
  }
}

function viewerTools(extensionManager: any) {
  return extensionManager
    ?.getModuleEntry?.('@ohif/extension-cornerstone.utilityModule.common')
    ?.exports?.getCornerstoneLibraries?.()?.cornerstoneTools;
}

/**
 * Fill unlabeled slices between drawn segment slices.
 * The stock command reports success when its worker returns the original
 * buffer unchanged, so the labelmap on screen never updates.
 */
export async function interpolateActiveLabelmap(servicesManager: any, extensionManager: any) {
  const { segmentationService, viewportGridService, uiNotificationService, cornerstoneViewportService } =
    servicesManager.services;
  const viewportId = viewportGridService.getActiveViewportId?.();
  const segmentation = viewportId ? segmentationService.getActiveSegmentation?.(viewportId) : null;
  const segment = viewportId ? segmentationService.getActiveSegment?.(viewportId) : null;
  const segmentationId = segmentation?.segmentationId;
  const segmentIndex = segment?.segmentIndex;

  const notify = (message: string, type: 'info' | 'warning' | 'success' | 'error') => {
    uiNotificationService?.show?.({
      title: 'Interpolate Labelmap',
      message,
      type,
      duration: 4000,
    });
  };

  if (!segmentationId || segmentIndex == null || segmentIndex < 1) {
    notify('Select a segment before interpolating.', 'info');
    return;
  }

  const tools = viewerTools(extensionManager);
  let volume = segmentationService.getLabelmapVolume?.(segmentationId) as LabelmapVolume | null;
  if (!volume?.voxelManager) {
    volume = tools?.utilities?.segmentation?.getOrCreateSegmentationVolume?.(segmentationId);
  }
  if (!volume?.voxelManager) {
    notify('The segmentation has no labelmap volume to interpolate.', 'warning');
    return;
  }

  const imageData = volume.imageData;
  const dimensions = imageData?.getDimensions?.() ?? volume.dimensions;
  const spacing = imageData?.getSpacing?.() ?? volume.spacing;
  const origin = imageData?.getOrigin?.() ?? volume.origin;
  const direction = flat9(imageData?.getDirection?.() ?? volume.direction);
  if (!dimensions || dimensions.length < 3 || !spacing || !origin) {
    notify('The segmentation volume is missing geometry, so slices cannot be filled.', 'warning');
    return;
  }

  const scalarData = readScalarData(volume);
  const frameSize = dimensions[0] * dimensions[1];
  if (!scalarData || scalarData.length !== frameSize * dimensions[2]) {
    notify('The segmentation volume has no voxel data to interpolate.', 'warning');
    return;
  }

  const labeledSliceCount = slicesWithLabel(scalarData, dimensions, segmentIndex);
  if (labeledSliceCount < 2) {
    notify('Draw this segment on at least two separated slices, then interpolate.', 'info');
    return;
  }

  const imageType = new ImageType(3, IntTypes.UInt8, PixelTypes.Scalar, 1);
  const inputImage = new Image(imageType);
  inputImage.size = dimensions;
  inputImage.spacing = spacing;
  inputImage.origin = origin;
  inputImage.direction = direction;
  inputImage.data = scalarData instanceof Uint8Array ? scalarData : Uint8Array.from(scalarData);

  let outputData: ArrayLike<number> | undefined;
  try {
    const { outputImage } = await morphologicalContourInterpolation(inputImage, {
      label: segmentIndex,
      axis: 2,
      webWorker: false,
    });
    outputData = outputImage?.data;
  } catch (error) {
    console.warn('XNAT: morphological interpolation was unavailable', error);
  }

  const Ctor = (scalarData.constructor as new (length: number) => ScalarArray) || Uint8Array;
  const merged = new Ctor(scalarData.length);
  merged.set(scalarData);
  let changed = applyInterpolation(merged, scalarData, outputData, segmentIndex);

  if (!changed) {
    changed = fillGapsFromNearestLabeledSlice(merged, dimensions, segmentIndex);
  }

  if (!changed) {
    notify('No missing slices were filled. Draw the segment on slices with a gap between them.', 'warning');
    return;
  }

  const voxelManager = volume.voxelManager;
  if (voxelManager.setCompleteScalarDataArray) {
    voxelManager.setCompleteScalarDataArray(merged);
  } else if (voxelManager.setScalarData) {
    voxelManager.setScalarData(merged);
  }
  voxelManager.invalidateCache?.();

  const events = tools?.segmentation?.triggerSegmentationEvents;
  events?.triggerSegmentationDataModified?.(
    segmentationId,
    voxelManager.getArrayOfModifiedSlices?.() ?? [],
    segmentIndex
  );

  const renderingEngine = cornerstoneViewportService?.getRenderingEngine?.();
  renderingEngine?.render?.();

  notify('Filled the slices between the drawn segments.', 'success');
}
