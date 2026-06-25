import { adaptersSEG } from '@cornerstonejs/adapters';
import {
  CONSTANTS,
  Enums as ToolsEnums,
  segmentation as csSegmentation,
} from '@cornerstonejs/tools';
import {
  cache,
  getEnabledElementByViewportId,
  metaData,
  volumeLoader,
  VolumeViewport,
} from '@cornerstonejs/core';

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

/** Flatten labelMapImages into a single list of slice images, regardless of nesting. */
function getAllLabelmapImages(labelMapImages: any): any[] {
  if (!Array.isArray(labelMapImages)) {
    return [];
  }
  const out: any[] = [];
  for (const entry of labelMapImages) {
    if (Array.isArray(entry)) {
      out.push(...entry);
    } else if (entry) {
      out.push(entry);
    }
  }
  return out;
}

/**
 * OHIF's createSegmentationForSEGDisplaySet builds the panel's `segments` object keyed by
 * `Number(SegmentNumber)` from `segMetadata.data`. If the source SEG has duplicate, missing, or
 * non-sequential SegmentNumbers, those keys collide and the panel silently drops/relabels segments
 * (even though the viewer still renders every voxel value via the default color LUT).
 *
 * This reconciles the per-segment metadata with the labelmap so every distinct voxel value present
 * in the data gets its own sequential 1..N entry with a label, then remaps voxels + centroid keys to
 * match. It always runs (independent of labelMapImages nesting) and is a no-op for conformant SEGs.
 */
function reconcileSegmentsWithLabelmap(results: any) {
  const data = results.segMetadata?.data;
  if (!data) {
    return;
  }

  const images = getAllLabelmapImages(results.labelMapImages);

  // Distinct non-zero voxel values actually present in the labelmap (source of truth for the viewer).
  const present = new Set<number>();
  for (const img of images) {
    const vm = img?.voxelManager;
    if (!vm?.getScalarData) {
      continue;
    }
    const arr = vm.getScalarData();
    for (let k = 0; k < arr.length; k++) {
      if (arr[k] !== 0) {
        present.add(arr[k]);
      }
    }
  }

  // Per-segment metadata in SegmentSequence order (slot 0 is background).
  const metaEntries: { entry: any; segNum: number }[] = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i]) {
      continue;
    }
    const raw = Number(data[i].SegmentNumber);
    const segNum = Number.isFinite(raw) && raw > 0 ? raw : i;
    metaEntries.push({ entry: data[i], segNum });
  }

  if (metaEntries.length === 0 && present.size === 0) {
    return;
  }

  // Old segment values to expose = union of values present in voxels and values declared in metadata.
  // Using the union keeps voxel-only segments (missing/duplicate metadata) AND declared-but-empty ones.
  const oldValues = Array.from(new Set<number>([...present, ...metaEntries.map(m => m.segNum)])).sort(
    (a, b) => a - b
  );

  // First metadata entry for each declared SegmentNumber (for conformant lookup), plus a queue of
  // leftover entries to positionally back-fill voxel values that have no matching metadata.
  const metaBySegNum = new Map<number, any>();
  metaEntries.forEach(({ entry, segNum }) => {
    if (!metaBySegNum.has(segNum)) {
      metaBySegNum.set(segNum, entry);
    }
  });
  const leftover = metaEntries.filter(({ segNum }, idx) => metaEntries.findIndex(m => m.segNum === segNum) !== idx);
  let leftoverPtr = 0;

  const oldToNew = new Map<number, number>();
  const newData: any[] = [undefined];

  oldValues.forEach((oldVal, idx) => {
    const newIndex = idx + 1;
    oldToNew.set(oldVal, newIndex);

    let source = metaBySegNum.get(oldVal);
    if (!source) {
      source = leftover[leftoverPtr]?.entry;
      leftoverPtr++;
    }

    const entry = source ? { ...source } : {};
    entry.SegmentNumber = newIndex;
    if (!entry.SegmentLabel) {
      entry.SegmentLabel = `Segment ${newIndex}`;
    }
    newData[newIndex] = entry;
  });

  results.segMetadata.data = newData;

  // Remap voxels so values are sequential 1..N and aligned with the rebuilt metadata.
  for (const img of images) {
    const vm = img?.voxelManager;
    if (!vm?.getScalarData) {
      continue;
    }
    const arr = vm.getScalarData();
    let changed = false;
    for (let k = 0; k < arr.length; k++) {
      const v = arr[k];
      if (v !== 0 && oldToNew.has(v) && oldToNew.get(v) !== v) {
        arr[k] = oldToNew.get(v) as number;
        changed = true;
      }
    }
    if (changed) {
      vm.setScalarData(arr);
    }
  }

  // Centroids are keyed by the old voxel value / SegmentNumber.
  if (results.centroids instanceof Map) {
    const next = new Map();
    results.centroids.forEach((val: unknown, key: number) => {
      next.set(oldToNew.has(key) ? oldToNew.get(key) : key, val);
    });
    results.centroids = next;
  }
}

/**
 * Toggle to print slice-ordering diagnostics during SEG import. Set to false to silence.
 * Remove this block (and the call below) once the flip root cause is confirmed.
 */
const SEG_IMPORT_DEBUG = false;

function projectionOnNormal(ipp: number[], normal: number[]): number {
  return ipp[0] * normal[0] + ipp[1] * normal[1] + ipp[2] * normal[2];
}

function crossProduct(a: number[], b: number[]): number[] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/**
 * Logs, for both the reference stack and the parsed labelmap, the geometric slice order
 * (ImagePositionPatient projected on the scan-axis normal) plus which slices carry mask
 * voxels. Comparing a flipping vs non-flipping import makes the z-reversal cause obvious.
 */
function logSegImportDiagnostics(results: any, imageIds: string[]) {
  if (!SEG_IMPORT_DEBUG) {
    return;
  }
  try {
    const firstPlane = metaData.get('imagePlaneModule', imageIds[0]) as any;
    if (!firstPlane?.imageOrientationPatient) {
      console.warn('[SEG import] No imagePlaneModule for first reference imageId; skipping diagnostics');
      return;
    }
    const iop = firstPlane.imageOrientationPatient.map(Number);
    const normal = crossProduct(iop.slice(0, 3), iop.slice(3, 6));

    const refRows = imageIds.map((imageId, index) => {
      const plane = metaData.get('imagePlaneModule', imageId) as any;
      const ipp = plane?.imagePositionPatient?.map(Number) ?? [0, 0, 0];
      return { index, imageId, proj: projectionOnNormal(ipp, normal) };
    });

    const projs = refRows.map(r => r.proj);
    let ascending = true;
    let descending = true;
    for (let i = 1; i < projs.length; i++) {
      if (projs[i] < projs[i - 1] - 1e-3) ascending = false;
      if (projs[i] > projs[i - 1] + 1e-3) descending = false;
    }
    const order = ascending ? 'ASCENDING' : descending ? 'DESCENDING' : 'NON-MONOTONIC';
    console.log(
      `[SEG import] reference stack: ${imageIds.length} slices, scan-normal projection order = ${order}`
    );
    console.log('[SEG import] reference normal =', normal, 'first/last proj =', projs[0], projs[projs.length - 1]);

    const labelmaps = Array.isArray(results.labelMapImages?.[0])
      ? results.labelMapImages[0]
      : results.labelMapImages;

    if (Array.isArray(labelmaps)) {
      const maskSlices = labelmaps
        .map((img: any, arrayIndex: number) => {
          const vm = img?.voxelManager;
          const arr = vm?.getScalarData ? vm.getScalarData() : null;
          let nonZero = 0;
          if (arr) {
            for (let k = 0; k < arr.length; k++) {
              if (arr[k] !== 0) nonZero++;
            }
          }
          const refId = img?.referencedImageId;
          const refIndex = refId ? imageIds.indexOf(refId) : -1;
          const proj = refIndex >= 0 ? refRows[refIndex].proj : NaN;
          return { arrayIndex, refIndex, proj, nonZero };
        })
        .filter((s: any) => s.nonZero > 0);

      console.log(
        `[SEG import] labelmap slices with voxels (arrayIndex -> refIndex @ proj : voxelCount):`
      );
      maskSlices.forEach((s: any) =>
        console.log(
          `  arr#${s.arrayIndex} -> ref#${s.refIndex} @ ${Number.isNaN(s.proj) ? '??' : s.proj.toFixed(2)} : ${s.nonZero}`
        )
      );
      if (maskSlices.length) {
        const refIdxs = maskSlices.map((s: any) => s.refIndex).filter((i: number) => i >= 0);
        console.log(
          `[SEG import] mask refIndex range = [${Math.min(...refIdxs)} .. ${Math.max(...refIdxs)}] of 0..${imageIds.length - 1}`
        );
      }
    }
  } catch (err) {
    console.warn('[SEG import] diagnostics failed:', err);
  }
}

type StackLabelmapImage = {
  referencedImageId?: string;
  imageId?: string;
  voxelManager?: { getScalarData?: () => ArrayLike<number> };
};

function getFlatLabelmapStack(labelMapImages: any): StackLabelmapImage[] {
  if (!Array.isArray(labelMapImages) || !labelMapImages.length) {
    return [];
  }
  return Array.isArray(labelMapImages[0]) ? labelMapImages[0] : labelMapImages;
}

function copyStackLabelmapsIntoVolume(
  segVolume: { dimensions: number[]; imageIds: string[] },
  refVolumeImageIds: string[],
  labelmapByRefId: Map<string, StackLabelmapImage>
): void {
  const sliceSize = segVolume.dimensions[0] * segVolume.dimensions[1];

  refVolumeImageIds.forEach((refImageId, frameIndex) => {
    const labelmapImage = labelmapByRefId.get(refImageId);
    if (!labelmapImage) {
      return;
    }

    const srcData = labelmapImage.voxelManager?.getScalarData?.();
    if (!srcData || srcData.length !== sliceSize) {
      return;
    }

    const derivedImageId = segVolume.imageIds[frameIndex];
    const derivedImage = cache.getImage(derivedImageId) as {
      getPixelData?: () => Uint8Array;
      voxelManager?: { setScalarData?: (data: Uint8Array) => void };
    } | undefined;
    if (!derivedImage) {
      return;
    }

    const targetData = derivedImage.getPixelData?.();
    if (!targetData || targetData.length !== sliceSize) {
      return;
    }

    targetData.set(srcData as Uint8Array);
    derivedImage.voxelManager?.setScalarData?.(targetData);
  });
}

/**
 * Align imported labelmap geometry with the active viewport. Stack labelmaps are reordered to
 * match viewport.getImageIds(); volume viewports get a derived labelmap volume cloned from the
 * reference volume so each mask slice lands on the correct frame index regardless of display-set
 * instance order (ascending vs descending).
 */
function patchSegmentationGeometryForViewport(
  segmentationId: string,
  viewportId: string,
  flatLabelmaps: StackLabelmapImage[]
): void {
  const enabledElement = getEnabledElementByViewportId(viewportId);
  const viewport = enabledElement?.viewport;
  if (!viewport || !flatLabelmaps.length) {
    return;
  }

  const segmentation = csSegmentation.state.getSegmentation(segmentationId);
  const labelmapData = segmentation?.representationData?.[
    ToolsEnums.SegmentationRepresentations.Labelmap
  ] as {
    volumeId?: string;
    imageIds?: string[];
    referencedImageIds?: string[];
  } | undefined;

  if (!labelmapData) {
    return;
  }

  const labelmapByRefId = new Map<string, StackLabelmapImage>();
  flatLabelmaps.forEach(lm => {
    if (lm.referencedImageId) {
      labelmapByRefId.set(lm.referencedImageId, lm);
    }
  });

  if (viewport instanceof VolumeViewport) {
    const refVolumeId = viewport.getVolumeId?.();
    if (!refVolumeId) {
      return;
    }

    const refVolume = cache.getVolume(refVolumeId);
    const refVolumeImageIds = refVolume?.imageIds;
    if (!refVolumeImageIds?.length) {
      return;
    }

    const segVolumeId = `xnat-labelmap-${segmentationId}`;
    const segVolume = volumeLoader.createAndCacheDerivedLabelmapVolume(refVolumeId, {
      volumeId: segVolumeId,
    });

    copyStackLabelmapsIntoVolume(segVolume, refVolumeImageIds, labelmapByRefId);

    labelmapData.volumeId = segVolumeId;
    labelmapData.imageIds = [...segVolume.imageIds];
    labelmapData.referencedImageIds = [...refVolumeImageIds];
    return;
  }

  const stackImageIds: string[] = viewport.getImageIds?.() ?? [];
  if (!stackImageIds.length || stackImageIds.length !== flatLabelmaps.length) {
    return;
  }

  const ordered = stackImageIds
    .map(refId => labelmapByRefId.get(refId))
    .filter((lm): lm is StackLabelmapImage => Boolean(lm));

  if (ordered.length !== stackImageIds.length) {
    return;
  }

  labelmapData.imageIds = ordered.map(lm => lm.imageId).filter(Boolean) as string[];
  labelmapData.referencedImageIds = [...stackImageIds];
  delete labelmapData.volumeId;

  csSegmentation.state.updateLabelmapSegmentationImageReferences(viewportId, segmentationId);
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
    reconcileSegmentsWithLabelmap(results);

    logSegImportDiagnostics(results, imageIds);

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
    const flatLabelmaps = getFlatLabelmapStack(results.labelMapImages);
    const createdSegmentationId = await segmentationService.createSegmentationForSEGDisplaySet(
      segDisplaySet,
      {
        segmentationId,
        type: ToolsEnums.SegmentationRepresentations.Labelmap,
      }
    );

    const activeViewportId = viewportGridService.getActiveViewportId();

    // Place each mask slice on the frame index used by the viewport's reference volume/stack.
    patchSegmentationGeometryForViewport(createdSegmentationId, activeViewportId, flatLabelmaps);

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