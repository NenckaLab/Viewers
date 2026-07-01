import { adaptersSEG } from '@cornerstonejs/adapters';
import {
  CONSTANTS,
  Enums as ToolsEnums,
  segmentation as csSegmentation,
} from '@cornerstonejs/tools';

const { convertStackToVolumeLabelmap } = csSegmentation.helpers;
import { cache, metaData } from '@cornerstonejs/core';
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

function toPoint3(value: unknown): [number, number, number] | null {
  if (!value) {
    return null;
  }
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    const arr = Array.from(value as ArrayLike<number>);
    if (arr.length < 3) {
      return null;
    }
    const [x, y, z] = arr;
    if ([x, y, z].some(component => component === undefined || component === null)) {
      return null;
    }
    return [Number(x), Number(y), Number(z)];
  }
  if (typeof value === 'object') {
    const { x, y, z } = value as Record<string, number>;
    if ([x, y, z].some(component => component === undefined || component === null)) {
      return null;
    }
    return [Number(x), Number(y), Number(z)];
  }
  return null;
}

function normalizeVector(vector: [number, number, number]): [number, number, number] | null {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (!length) {
    return null;
  }
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function dotProduct(a: [number, number, number], b: [number, number, number]) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function crossProduct3(
  a: [number, number, number],
  b: [number, number, number]
): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** Ascending scan-normal order for SEG frame matching (Cornerstone volume convention). */
function sortImageIdsByImagePosition(imageIds: string[]): string[] {
  if (!imageIds || imageIds.length < 2) {
    return imageIds;
  }

  const planeData = imageIds.map(imageId => ({
    imageId,
    plane: metaData.get('imagePlaneModule', imageId) as Record<string, unknown> | undefined,
  }));

  if (planeData.some(entry => !entry.plane)) {
    return imageIds;
  }

  const referenceEntry = planeData.find(({ plane }) => {
    const position = toPoint3(plane?.imagePositionPatient);
    const rowCosines = toPoint3(plane?.rowCosines);
    const columnCosines = toPoint3(plane?.columnCosines);
    return Boolean(position && rowCosines && columnCosines);
  });

  if (!referenceEntry?.plane) {
    return imageIds;
  }

  const rowCosines = toPoint3(referenceEntry.plane.rowCosines);
  const columnCosines = toPoint3(referenceEntry.plane.columnCosines);
  const normal =
    rowCosines && columnCosines
      ? normalizeVector(crossProduct3(rowCosines, columnCosines))
      : null;

  if (!normal) {
    return imageIds;
  }

  const sortableData: { imageId: string; distance: number }[] = [];

  for (const { imageId, plane } of planeData) {
    const position = toPoint3(plane?.imagePositionPatient);
    if (!position) {
      return imageIds;
    }
    sortableData.push({
      imageId,
      distance: dotProduct(position, normal),
    });
  }

  const sortedData = [...sortableData].sort((a, b) => a.distance - b.distance);
  const alreadySorted = sortableData.every(
    (entry, index) => entry.imageId === sortedData[index].imageId
  );

  return alreadySorted ? imageIds : sortedData.map(entry => entry.imageId);
}

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
    const oldIndex = labelmapImages.findIndex(
      image => image?.referencedImageId === referenceImageId
    );

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

function instanceOrderMatchesGeometricSort(instanceImageIds: string[]): boolean {
  const geometricImageIds = sortImageIdsByImagePosition([...instanceImageIds]);
  return instanceImageIds.every((id, index) => id === geometricImageIds[index]);
}

/** True when display-set instances are stored low→high along the scan axis. */
function isAscendingInstanceOrder(instanceImageIds: string[]): boolean {
  return instanceOrderMatchesGeometricSort(instanceImageIds);
}

async function ensureVolumeLoaded(volume: { load?: (...args: unknown[]) => unknown }): Promise<void> {
  if (typeof volume?.load !== 'function') {
    return;
  }
  const loadResult = volume.load();
  if (loadResult && typeof (loadResult as Promise<unknown>).then === 'function') {
    await loadResult;
  }
}

/**
 * Reverse labelmap voxel data along the volume k-axis. Ascending instance-order series
 * use the same convertStackToVolumeLabelmap path as descending series, but the overlay
 * ends up mirrored along z; flipping the cached labelmap volume fixes alignment.
 */
async function flipLabelmapVolumeAlongKAxis(volumeId: string): Promise<boolean> {
  const volume = cache.getVolume(volumeId);
  const voxelManager = volume?.voxelManager;
  const dimensions = volume?.dimensions;

  if (!voxelManager?.getAtIndex || !voxelManager?.setAtIndex || !dimensions || dimensions.length < 3) {
    return false;
  }

  await ensureVolumeLoaded(volume);

  const frameSize = dimensions[0] * dimensions[1];
  const numFrames = dimensions[2];
  if (numFrames < 2) {
    return false;
  }

  const readFrame = (frameIndex: number): Uint8Array => {
    const frame = new Uint8Array(frameSize);
    const start = frameIndex * frameSize;
    for (let i = 0; i < frameSize; i++) {
      frame[i] = Number(voxelManager.getAtIndex(start + i) ?? 0);
    }
    return frame;
  };

  const writeFrame = (frameIndex: number, data: Uint8Array) => {
    const start = frameIndex * frameSize;
    for (let i = 0; i < frameSize; i++) {
      voxelManager.setAtIndex(start + i, data[i]);
    }
  };

  for (let k = 0; k < Math.floor(numFrames / 2); k++) {
    const opposite = numFrames - 1 - k;
    const frameK = readFrame(k);
    const frameOpposite = readFrame(opposite);
    writeFrame(k, frameOpposite);
    writeFrame(opposite, frameK);
  }

  if (SEG_IMPORT_DEBUG) {
    console.log(`[SEG import] flipped labelmap volume k-axis for ${volumeId}`);
  }

  return true;
}

/**
 * Reorder labelmap slices to match a reference imageId list (by referencedImageId).
 */
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

/** Frame order used by the active viewport's reference volume or stack. */
function getViewportReferenceImageIds(viewportId: string, servicesManager: any): string[] | null {
  const { cornerstoneViewportService } = servicesManager.services;
  const viewport = cornerstoneViewportService?.getCornerstoneViewport(viewportId);
  if (!viewport) {
    return null;
  }

  try {
    const volumeId =
      typeof viewport.getVolumeId === 'function' ? viewport.getVolumeId() : undefined;
    if (volumeId) {
      const volume = cache.getVolume(volumeId);
      if (volume?.imageIds?.length) {
        return [...volume.imageIds];
      }
    }
  } catch {
    // stack viewports may not expose getVolumeId
  }

  if (typeof viewport.getImageIds === 'function') {
    const stackImageIds = viewport.getImageIds();
    if (stackImageIds?.length) {
      return [...stackImageIds];
    }
  }

  return null;
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
const SEG_IMPORT_DEBUG = true;

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

function getReferenceImageIds(displaySet: any): string[] {
  // Must match SegmentationService.createSegmentationForSEGDisplaySet (instances → imageId).
  if (displaySet.instances?.length) {
    return displaySet.instances.map((inst: any) => inst.imageId).filter(Boolean);
  }
  if (displaySet.imageIds?.length) {
    return displaySet.imageIds.filter(Boolean);
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
    const instanceImageIds = getReferenceImageIds(referencedDisplaySet);

    if (!instanceImageIds || instanceImageIds.length === 0) {
      throw new Error('No image IDs found in referenced display set');
    }

    const activeViewportId = viewportGridService.getActiveViewportId();

    // Parse with display-set instance order (matches createSegmentationForSEGDisplaySet).
    const tolerance = 0.001;
    const results = await adaptersSEG.Cornerstone3D.Segmentation.createFromDICOMSegBuffer(
      instanceImageIds,
      arrayBuffer,
      { metadataProvider: metaData, tolerance }
    );

    if (!results) {
      throw new Error('Failed to parse DICOM SEG file');
    }

    alignLabelmapImagesWithReferences(results, instanceImageIds);

    mergeOverlappingLabelMapStacks(results);
    reconcileSegmentsWithLabelmap(results);

    const ascendingInstanceOrder = isAscendingInstanceOrder(instanceImageIds);

    logSegImportDiagnostics(results, instanceImageIds);

    if (SEG_IMPORT_DEBUG) {
      const viewportImageIds = getViewportReferenceImageIds(activeViewportId, servicesManager);
      console.log(`[SEG import] ascending instance order = ${ascendingInstanceOrder}`);
      if (viewportImageIds) {
        const viewportMatchesInstance = viewportImageIds.every(
          (id, index) => id === instanceImageIds[index]
        );
        console.log(
          `[SEG import] viewport ref order matches instance = ${viewportMatchesInstance}`
        );
      }
    }

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
    const createdSegmentationId = await segmentationService.createSegmentationForSEGDisplaySet(
      segDisplaySet,
      {
        segmentationId,
        type: ToolsEnums.SegmentationRepresentations.Labelmap,
      }
    );

    await segmentationService.addSegmentationRepresentation(activeViewportId, {
      segmentationId: createdSegmentationId,
      type: ToolsEnums.SegmentationRepresentations.Labelmap,
    });

    if (ascendingInstanceOrder) {
      let segmentation = csSegmentation.state.getSegmentation(createdSegmentationId);
      const labelmapKey = ToolsEnums.SegmentationRepresentations.Labelmap;
      let labelmapData = segmentation?.representationData?.[labelmapKey] as {
        volumeId?: string;
      };

      if (segmentation && !labelmapData?.volumeId) {
        try {
          await convertStackToVolumeLabelmap(segmentation);
          segmentation = csSegmentation.state.getSegmentation(createdSegmentationId);
          labelmapData = segmentation?.representationData?.[labelmapKey] as {
            volumeId?: string;
          };
          if (SEG_IMPORT_DEBUG) {
            console.log(
              `[SEG import] convertStackToVolumeLabelmap volumeId = ${labelmapData?.volumeId ?? 'none'}`
            );
          }
        } catch (convertError) {
          console.warn('XNAT SEG import: convertStackToVolumeLabelmap failed:', convertError);
        }
      }

      if (labelmapData?.volumeId) {
        try {
          const flipped = await flipLabelmapVolumeAlongKAxis(labelmapData.volumeId);
          if (flipped) {
            csSegmentation.triggerSegmentationEvents.triggerSegmentationDataModified(
              createdSegmentationId
            );
            csSegmentation.triggerSegmentationEvents.triggerSegmentationRepresentationModified(
              activeViewportId,
              createdSegmentationId,
              ToolsEnums.SegmentationRepresentations.Labelmap
            );
          }
          if (SEG_IMPORT_DEBUG) {
            console.log(`[SEG import] ascending k-axis correction applied = ${flipped}`);
          }
        } catch (flipError) {
          console.warn('XNAT SEG import: labelmap k-axis flip failed:', flipError);
        }
      } else if (SEG_IMPORT_DEBUG) {
        console.warn('[SEG import] no labelmap volumeId after stack→volume conversion');
      }
    }

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