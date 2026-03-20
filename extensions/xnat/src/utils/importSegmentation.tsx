import { adaptersSEG } from '@cornerstonejs/adapters';
import {
  CONSTANTS,
  Enums as ToolsEnums,
  segmentation as csSegmentation,
} from '@cornerstonejs/tools';
import { metaData } from '@cornerstonejs/core';

/**
 * RGBA for label index `segmentLabel` — same entries as platform/core
 * SegmentationService uses via `generateNewColorLUT` → `cloneDeep(COLOR_LUT)`.
 */
function rgbaForOhifSegmentLabel(segmentLabel: number): number[] {
  const { COLOR_LUT } = CONSTANTS;
  if (segmentLabel >= 0 && segmentLabel < COLOR_LUT.length) {
    return [...COLOR_LUT[segmentLabel]];
  }
  const usable = COLOR_LUT.length - 1;
  if (usable <= 0) {
    return [128, 128, 128, 255];
  }
  const idx = 1 + ((segmentLabel - 1) % usable);
  return [...COLOR_LUT[idx]];
}

/**
 * Full default LUT clone — matches @ohif/core SegmentationService.generateNewColorLUT().
 */
function applyOhifDefaultSegmentationColorLUT(viewportId: string, segmentationId: string) {
  if (!viewportId || !segmentationId) {
    return;
  }
  const lut = structuredClone(CONSTANTS.COLOR_LUT);
  const newLutIndex = csSegmentation.state.addColorLUT(
    lut as Array<[number, number, number, number]>
  );
  csSegmentation.config.color.setColorLUT(viewportId, segmentationId, newLutIndex);
}

// Helper function to ensure centroids are properly structured
function ensureCentroidsStructure(centroids, segMetadata) {
  if (!centroids || !(centroids instanceof Map)) {
    console.warn('Creating empty centroids map');
    centroids = new Map();
  }

  // Ensure we have centroids for all segments
  if (segMetadata && segMetadata.data) {
    segMetadata.data.forEach((segmentInfo, index) => {
      if (index === 0) return; // Skip background segment

      if (!centroids.has(index)) {
        console.warn(`Missing centroid for segment ${index}, creating default`);
        centroids.set(index, {
          image: { x: 0, y: 0, z: 0 },
          world: { x: 0, y: 0, z: 0 }
        });
      } else {
        // Ensure the centroid has the correct structure
        const centroid = centroids.get(index);
        if (!centroid.image) {
          centroid.image = { x: 0, y: 0, z: 0 };
        }
        if (!centroid.world) {
          centroid.world = { x: 0, y: 0, z: 0 };
        }
      }
    });
  }

  return centroids;
}

type PermutationEntry = { newIndex: number; oldIndex: number };

function buildPermutation<T extends { referencedImageId?: string }>(
  labelmapImages: T[],
  referenceImageIds: string[]
): PermutationEntry[] | null {
  if (!labelmapImages?.length || !referenceImageIds?.length) {
    return null;
  }

  const permutation: PermutationEntry[] = [];
  let needsPermutation = false;

  for (let newIndex = 0; newIndex < referenceImageIds.length; newIndex++) {
    const referenceImageId = referenceImageIds[newIndex];
    const oldIndex = labelmapImages.findIndex(image => image?.referencedImageId === referenceImageId);

    if (oldIndex === -1) {
      return null;
    }

    permutation.push({ newIndex, oldIndex });
    if (oldIndex !== newIndex) {
      needsPermutation = true;
    }
  }

  return needsPermutation ? permutation : null;
}

function applyPermutation<T>(items: T[], permutation: PermutationEntry[]) {
  if (!items?.length || !permutation?.length) {
    return items;
  }

  const result = items.slice();
  const original = items.slice();

  permutation.forEach(({ newIndex, oldIndex }) => {
    if (newIndex < result.length && oldIndex < original.length) {
      result[newIndex] = original[oldIndex];
    }
  });

  return result;
}

/** Reorder parsed slices so stack order matches OHIF referenced instances (same as SegmentationService). */
function alignLabelmapImagesWithReferences(results: any, referenceImageIds: string[]) {
  if (!results?.labelMapImages?.length || !referenceImageIds?.length) {
    return;
  }

  const primaryLabelmaps = Array.isArray(results.labelMapImages[0])
    ? results.labelMapImages[0]
    : results.labelMapImages;

  const permutation = buildPermutation(primaryLabelmaps, referenceImageIds);

  if (!permutation) {
    return;
  }

  const reorder = (labelmaps: any[]) => applyPermutation(labelmaps, permutation);

  if (Array.isArray(results.labelMapImages[0])) {
    results.labelMapImages = results.labelMapImages.map(reorder);
  } else {
    results.labelMapImages = reorder(results.labelMapImages);
  }

  if (Array.isArray(results.segmentsOnFrame) && results.segmentsOnFrame.length) {
    results.segmentsOnFrame = reorder(results.segmentsOnFrame);
  }
}

/**
 * Overlapping segments are returned as separate labelmap stacks. OHIF flattens labelMapImages,
 * which concatenates stacks and leaves only the first segment usable. Merge into one stack.
 */
function mergeOverlappingLabelMapStacks(results: any) {
  const stacks = results.labelMapImages;
  if (!Array.isArray(stacks) || stacks.length <= 1) {
    return;
  }

  const firstStack = stacks[0];
  if (!Array.isArray(firstStack) || !firstStack.length) {
    return;
  }

  const numSlices = firstStack.length;
  for (let s = 1; s < stacks.length; s++) {
    const st = stacks[s];
    if (!Array.isArray(st) || st.length !== numSlices) {
      console.warn(
        'XNAT SEG import: segment stack slice count mismatch; overlapping merge may be incomplete'
      );
    }
  }

  for (let sliceIdx = 0; sliceIdx < numSlices; sliceIdx++) {
    const baseImg = firstStack[sliceIdx];
    const vm0 = baseImg?.voxelManager;
    if (!vm0?.getScalarData) {
      continue;
    }
    const baseData = vm0.getScalarData();
    const merged = new baseData.constructor(baseData.length);
    merged.set(baseData);
    for (let s = 1; s < stacks.length; s++) {
      const otherVm = stacks[s]?.[sliceIdx]?.voxelManager;
      if (!otherVm?.getScalarData) {
        continue;
      }
      const od = otherVm.getScalarData();
      for (let p = 0; p < merged.length; p++) {
        if (od[p] !== 0) {
          merged[p] = od[p];
        }
      }
    }
    vm0.setScalarData(merged);
  }

  results.labelMapImages = [firstStack];
  results.overlappingSegments = false;
}

/**
 * OHIF builds the color LUT in SegmentSequence order (data[1], data[2], …) but voxel values use
 * SegmentNumber. Remap to sequential 1..N and align voxels + centroid keys.
 */
function normalizeSegmentNumbersAndRemap(results: any) {
  const data = results.segMetadata?.data;
  const stacks = results.labelMapImages;
  if (!data || !Array.isArray(stacks) || !stacks[0]?.length) {
    return;
  }

  const sliceImages = stacks[0];
  const entries: { slot: number; old: number }[] = [];

  for (let i = 1; i < data.length; i++) {
    if (!data[i]) {
      continue;
    }
    const raw = Number(data[i].SegmentNumber);
    const old = Number.isFinite(raw) && raw > 0 ? raw : i;
    entries.push({ slot: i, old });
  }

  if (entries.length === 0) {
    return;
  }

  const oldToNew = new Map<number, number>();
  entries.forEach((e, idx) => {
    oldToNew.set(e.old, idx + 1);
    data[e.slot].SegmentNumber = idx + 1;
  });

  for (const img of sliceImages) {
    const vm = img?.voxelManager;
    if (!vm?.getScalarData) {
      continue;
    }
    const arr = vm.getScalarData();
    for (let k = 0; k < arr.length; k++) {
      const v = arr[k];
      if (v !== 0) {
        arr[k] = oldToNew.has(v) ? oldToNew.get(v) : v;
      }
    }
    vm.setScalarData(arr);
  }

  if (results.centroids instanceof Map) {
    const next = new Map();
    results.centroids.forEach((val: unknown, key: number) => {
      const nk = oldToNew.has(key) ? oldToNew.get(key) : key;
      next.set(nk, val);
    });
    results.centroids = next;
  }
}

function getReferenceImageIds(displaySet: any): string[] {
  if (displaySet.instances?.length) {
    return displaySet.instances.map((inst: any) => inst.imageId).filter(Boolean);
  }
  if (displaySet.imageIds?.length) {
    return [...displaySet.imageIds];
  }
  return displaySet.images?.map((img: any) => img.imageId).filter(Boolean) ?? [];
}

interface ImportSegmentationParams {
  arrayBuffer: ArrayBuffer;
  studyInstanceUID: string;
  seriesInstanceUID: string;
  servicesManager: any;
  label?: string; // Optional custom label for the imported segmentation
}

/**
 * Imports a DICOM SEG file and creates a segmentation in OHIF
 */
export const importSegmentation = async ({
  arrayBuffer,
  studyInstanceUID,
  seriesInstanceUID,
  servicesManager,
  label,
}: ImportSegmentationParams): Promise<string> => {
  const { segmentationService, displaySetService, viewportGridService } = servicesManager.services;

  try {
    // Find the display set for the referenced series. Must match series first:
    // using (series OR study) would return the first series in the study and break
    // import when the viewport is on a later acquisition.
    const displaySets = displaySetService.getActiveDisplaySets();
    let referencedDisplaySet = seriesInstanceUID
      ? displaySets.find(ds => ds.SeriesInstanceUID === seriesInstanceUID)
      : undefined;
    if (!referencedDisplaySet && studyInstanceUID) {
      referencedDisplaySet = displaySets.find(ds => ds.StudyInstanceUID === studyInstanceUID);
    }

    if (!referencedDisplaySet) {
      throw new Error('Referenced display set not found');
    }

    // Same order as SegmentationService.createSegmentationForSEGDisplaySet (instances → imageId)
    const imageIds = getReferenceImageIds(referencedDisplaySet);

    if (!imageIds || imageIds.length === 0) {
      throw new Error('No image IDs found in referenced display set');
    }

    // Parse the DICOM SEG file using cornerstone adapters
    const tolerance = 0.001;
    const results = await adaptersSEG.Cornerstone3D.Segmentation.createFromDICOMSegBuffer(
      imageIds,
      arrayBuffer,
      { metadataProvider: metaData, tolerance }
    );

    if (!results) {
      throw new Error('Failed to parse DICOM SEG file');
    }

    alignLabelmapImagesWithReferences(results, imageIds);
    mergeOverlappingLabelMapStacks(results);
    normalizeSegmentNumbersAndRemap(results);

    // Ensure centroids are properly structured
    results.centroids = ensureCentroidsStructure(results.centroids, results.segMetadata);

    // RGBA for extension createSegmentationForSEGDisplaySet — align with OHIF COLOR_LUT by segment index.
    if (results.segMetadata?.data) {
      results.segMetadata.data.forEach((data, i) => {
        if (i > 0 && data) {
          data.rgba = rgbaForOhifSegmentLabel(i);
        }
      });
    } else {
      console.warn('No segMetadata.data found in results:', results);
    }

    // Create a unique segmentation ID
    const segmentationId = `imported_seg_${Date.now()}`;

    // Create a segDisplaySet object similar to what cornerstone-dicom-seg creates
    const segmentationLabel = label || `XNAT Import ${new Date().toLocaleTimeString()}`;
    const segDisplaySet = {
      displaySetInstanceUID: segmentationId,
      referencedDisplaySetInstanceUID: referencedDisplaySet.displaySetInstanceUID,
      isOverlayDisplaySet: true,
      label: segmentationLabel,
      SeriesDescription: segmentationLabel, // This is what the cornerstone service uses for the segmentation label
      SeriesDate: new Date().toISOString().split('T')[0], // Add SeriesDate for modifiedTime
      ...results, // Include all the parsed SEG data
    };
    // Create segmentation using the segmentation service with correct API
    const createdSegmentationId = await segmentationService.createSegmentationForSEGDisplaySet(
      segDisplaySet,
      {
        segmentationId,
        type: ToolsEnums.SegmentationRepresentations.Labelmap,
      }
    );
    // Get the active viewport ID
    const activeViewportId = viewportGridService.getActiveViewportId();

    // Add segmentation representation to the viewport
    await segmentationService.addSegmentationRepresentation(activeViewportId, {
      segmentationId: createdSegmentationId,
      type: ToolsEnums.SegmentationRepresentations.Labelmap,
    });

    applyOhifDefaultSegmentationColorLUT(activeViewportId, createdSegmentationId);

    // Set the imported segmentation as active
    segmentationService.setActiveSegmentation(activeViewportId, createdSegmentationId);

    return createdSegmentationId;
  } catch (error) {
    console.error('Error importing segmentation:', error);
    throw error;
  }
};

export default importSegmentation;